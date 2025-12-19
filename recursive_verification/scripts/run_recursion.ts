import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import type { FieldLike } from "@aztec/aztec.js/abi";
import { getSponsoredFPCInstance } from "./sponsored_fpc.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { ValueNotEqualContract } from "../contract/artifacts/ValueNotEqual";
import data from "../data.json";
import { getPXEConfig } from "@aztec/pxe/config";
import { TestWallet } from "@aztec/test-wallet/server";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { serializePrivateExecutionSteps } from "@aztec/stdlib/kernel";
import type {
  ContractFunctionInteraction,
  DeployMethod,
  DeployOptions,
  SendInteractionOptions,
} from "@aztec/aztec.js/contracts";
import assert from "node:assert";

export const NODE_URL = "http://localhost:8080";

const sponsoredFPC = await getSponsoredFPCInstance();
const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(
  sponsoredFPC.address
);

async function captureProfile(
  interaction: ContractFunctionInteraction | DeployMethod,
  opts: SendInteractionOptions | DeployOptions,
  label: string
) {
  const result = await interaction.profile({
    ...opts,
    profileMode: "full",
    skipProofGeneration: true,
  });
  const ivcFolder = process.env.CAPTURE_IVC_FOLDER ?? "ivc";
  const resultsDirectory = join(ivcFolder, label);
  await mkdir(resultsDirectory, { recursive: true });
  const ivcInputsPath = join(resultsDirectory, "ivc-inputs.msgpack");
  await writeFile(
    ivcInputsPath,
    serializePrivateExecutionSteps(result.executionSteps)
  );
}

export const setupWallet = async (): Promise<TestWallet> => {
  try {
    const aztecNode = await createAztecNodeClient(NODE_URL);
    const config = getPXEConfig();
    await rm("pxe", { recursive: true, force: true });
    config.dataDirectory = "pxe";
    config.proverEnabled = true;
    let wallet = await TestWallet.create(aztecNode, config);
    await wallet.registerContract({
      instance: sponsoredFPC,
      artifact: SponsoredFPCContract.artifact,
    });

    return wallet;
  } catch (error) {
    console.error("Failed to setup sandbox:", error);
    throw error;
  }
};

async function main() {
  const testWallet = await setupWallet();
  const account = await testWallet.createAccount();
  const manager = await account.getDeployMethod();
  await manager
    .send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod: sponsoredPaymentMethod },
    })
    .deployed();
  const accounts = await testWallet.getAccounts();

  const valueNotEqual = await ValueNotEqualContract.deploy(
    testWallet,
    10,
    accounts[0].item,
    data.vkHash as unknown as FieldLike
  )
    .send({
      from: accounts[0].item,
      fee: { paymentMethod: sponsoredPaymentMethod },
    })
    .deployed();

  const opts = {
    from: accounts[0].item,
    fee: { paymentMethod: sponsoredPaymentMethod },
  };

  const interaction = await valueNotEqual.methods.increment(
    accounts[0].item,
    data.vkAsFields as unknown as FieldLike[],
    data.proofAsFields as unknown as FieldLike[],
    data.publicInputs as unknown as FieldLike[],
  );

  await captureProfile(interaction, opts, "recursion");

  let counterValue = await valueNotEqual.methods
    .get_counter(accounts[0].item)
    .simulate({ from: accounts[0].item });
  console.log(`Counter value: ${counterValue}`);

  await interaction.send(opts).wait();

  counterValue = await valueNotEqual.methods
    .get_counter(accounts[0].item)
    .simulate({ from: accounts[0].item });
  console.log(`Counter value: ${counterValue}`);

  assert(counterValue === 11n);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
