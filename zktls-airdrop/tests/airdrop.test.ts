import { describe, expect, test, beforeAll, afterAll } from "vitest";
import type { FieldLike } from "@aztec/aztec.js/abi";
import { TxExecutionResult } from "@aztec/aztec.js/tx";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";

import { PrimusAirdropContract } from "../contract/artifacts/PrimusAirdrop.js";
import { TokenContract } from "../contract/artifacts/Token.js";
type TokenMethods = typeof TokenContract.prototype.methods;
import { getSponsoredFPCInstance } from "../scripts/sponsored_fpc.js";
import {
  parseAttestationFile,
  DEFAULT_ALLOWED_URLS,
  MAX_URL_LEN,
  MAX_PLAINTEXT_LEN,
} from "../scripts/parse_attestation.js";
import { computeAllowedUrlHashes } from "../scripts/compute_url_hashes.js";

const NODE_URL = "http://localhost:8080";
const TEST_TIMEOUT = 600_000;
const AIRDROP_AMOUNT = 1000n;

// No padding needed — the Aztec SDK encodes BoundedVec from raw arrays automatically.

describe("Primus zkTLS Airdrop (Token Standard)", () => {
  let wallet: EmbeddedWallet;
  let ownerAddress: AztecAddress;
  let airdrop: PrimusAirdropContract;
  let token: TokenContract;
  let paymentMethod: SponsoredFeePaymentMethod;
  let urlHashes: string[];

  beforeAll(async () => {
    console.log(`Connecting to Aztec node at ${NODE_URL}`);
    const aztecNode = await createAztecNodeClient(NODE_URL);

    const sponsoredFPC = await getSponsoredFPCInstance();
    paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

    wallet = await EmbeddedWallet.create(aztecNode, { ephemeral: true });
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact);

    console.log("Creating account...");
    const accountManager = await wallet.createSchnorrAccount(
      Fr.random(),
      Fr.random(),
    );
    await (await accountManager.getDeployMethod()).send({
      from: NO_FROM,
      fee: { paymentMethod },
    });

    const accounts = await wallet.getAccounts();
    ownerAddress = accounts[0].item;
    console.log(`Owner: ${ownerAddress.toString()}`);

    urlHashes = await computeAllowedUrlHashes(DEFAULT_ALLOWED_URLS);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (wallet) await wallet.stop();
  });

  test("should deploy airdrop and token contracts", async () => {
    const sendOpts = { from: ownerAddress, fee: { paymentMethod } };

    // Step 1: Deploy PrimusAirdrop
    ({ contract: airdrop } = await PrimusAirdropContract.deploy(
      wallet,
      ownerAddress, // deployer
      urlHashes as unknown as FieldLike[],
      AIRDROP_AMOUNT,
    ).send(sendOpts));

    expect(airdrop.address).toBeDefined();
    console.log(`Airdrop: ${airdrop.address.toString()}`);

    // Step 2: Deploy Token with minter = airdrop
    ({ contract: token } = await TokenContract.deployWithOpts<"constructor_with_minter">(
      { method: "constructor_with_minter", wallet },
      "Primus Airdrop Token",
      "PRIMUS",
      18,
      airdrop.address,
    ).send(sendOpts));

    expect(token.address).toBeDefined();
    console.log(`Token: ${token.address.toString()}`);

    // Step 3: Link airdrop → token
    const { receipt } = await airdrop.methods
      .set_token(token.address)
      .send(sendOpts);
    expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);
    console.log("Linked airdrop → token");
  }, TEST_TIMEOUT);

  test("should reject set_token called twice", async () => {
    const sendOpts = { from: ownerAddress, fee: { paymentMethod } };

    // PublicImmutable::initialize fails on second call
    await expect(
      airdrop.methods.set_token(token.address).send(sendOpts),
    ).rejects.toThrow();

    console.log("Double set_token correctly rejected");
  }, TEST_TIMEOUT);

  test(
    "should claim airdrop and receive private tokens",
    async () => {
      const fs = await import("fs");
      const attestationPath = "testdata/attestation.json";
      if (!fs.existsSync(attestationPath)) {
        console.log(
          "Skipping: no attestation file. Run generate_attestation.ts first.",
        );
        return;
      }

      const parsed = parseAttestationFile(attestationPath, DEFAULT_ALLOWED_URLS);
      const sendOpts = { from: ownerAddress, fee: { paymentMethod } };

      const { receipt } = await airdrop.methods
        .claim(
          parsed.publicKeyX as unknown as FieldLike[],
          parsed.publicKeyY as unknown as FieldLike[],
          parsed.hash as unknown as FieldLike[],
          parsed.signature as unknown as FieldLike[],
          parsed.requestUrls as unknown as FieldLike[][],
          parsed.allowedUrls as unknown as FieldLike[][],
          parsed.dataHashes as unknown as FieldLike[][],
          parsed.contents as unknown as FieldLike[][],
          parsed.githubUsername as unknown as FieldLike[],
          parsed.githubId as unknown as FieldLike[],
        )
        .send(sendOpts);

      expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);
      console.log(`Claim tx: ${receipt.txHash.toString()}`);

      // Verify private token balance via the Token contract
      const balanceResult = await token.methods
        .balance_of_private(ownerAddress)
        .simulate({ from: ownerAddress });
      // The simulate result may be { result: bigint } or a raw value
      const balance = typeof balanceResult === "object" && "result" in balanceResult
        ? (balanceResult as any).result
        : balanceResult;
      console.log(`Private token balance: ${balance} (type: ${typeof balance})`);
      expect(balance).toBe(AIRDROP_AMOUNT);
    },
    TEST_TIMEOUT,
  );

  test(
    "should reject double claim (duplicate nullifier)",
    async () => {
      const fs = await import("fs");
      const attestationPath = "testdata/attestation.json";
      if (!fs.existsSync(attestationPath)) {
        console.log("Skipping: no attestation file.");
        return;
      }

      const parsed = parseAttestationFile(attestationPath, DEFAULT_ALLOWED_URLS);
      const sendOpts = { from: ownerAddress, fee: { paymentMethod } };

      await expect(
        airdrop.methods
          .claim(
            parsed.publicKeyX as unknown as FieldLike[],
            parsed.publicKeyY as unknown as FieldLike[],
            parsed.hash as unknown as FieldLike[],
            parsed.signature as unknown as FieldLike[],
            parsed.requestUrls.map((u) => (u, MAX_URL_LEN)) as unknown as FieldLike[][],
            parsed.allowedUrls.map((u) => (u, MAX_URL_LEN)) as unknown as FieldLike[][],
            parsed.dataHashes as unknown as FieldLike[][],
            parsed.contents.map((c) => (c, MAX_PLAINTEXT_LEN)) as unknown as FieldLike[][],
            (parsed.githubUsername, MAX_PLAINTEXT_LEN) as unknown as FieldLike[],
            (parsed.githubId, MAX_PLAINTEXT_LEN) as unknown as FieldLike[],
          )
          .send(sendOpts),
      ).rejects.toThrow();

      console.log("Double claim correctly rejected");
    },
    TEST_TIMEOUT,
  );
});
