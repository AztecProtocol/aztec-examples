/**
 * benchmark.ts
 *
 * Profiles the PrimusAirdrop contract operations and reports gate counts,
 * witness generation times, and proving statistics.
 *
 * Prerequisites:
 *   - Aztec local network running: `aztec start --local-network`
 *   - Contract compiled: `yarn ccc`
 *   - Attestation file at testdata/attestation.json
 *
 * Usage:
 *   npx tsx scripts/benchmark.ts
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import type { FieldLike } from "@aztec/aztec.js/abi";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import type { ContractFunctionInteraction, DeployMethod } from "@aztec/aztec.js/contracts";

import { PrimusAirdropContract } from "../contract/artifacts/PrimusAirdrop.js";
import { TokenContract } from "../contract/artifacts/Token.js";
import { getSponsoredFPCInstance } from "./sponsored_fpc.js";
import {
  parseAttestationFile,
  DEFAULT_ALLOWED_URLS,
} from "./parse_attestation.js";
import { computeAllowedUrlHashes } from "./compute_url_hashes.js";

const NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const AIRDROP_AMOUNT = 1000n;

interface BenchmarkResult {
  label: string;
  functions: {
    name: string;
    gateCount?: number;
    witgenMs: number;
    oracles?: Record<string, { calls: number; totalMs: number }>;
  }[];
  totalMs: number;
  provingMs?: number;
  syncMs?: number;
}

async function profileInteraction(
  interaction: ContractFunctionInteraction | DeployMethod,
  opts: any,
  label: string,
): Promise<BenchmarkResult> {
  const start = performance.now();
  const result = await interaction.profile({
    ...opts,
    profileMode: "gates",
    skipProofGeneration: true,
  });
  const elapsed = performance.now() - start;

  const functions = result.executionSteps.map((step: any) => {
    const oracleStats: Record<string, { calls: number; totalMs: number }> = {};
    if (step.timings.oracles) {
      for (const [name, data] of Object.entries(step.timings.oracles) as any) {
        oracleStats[name] = {
          calls: data.times.length,
          totalMs: Math.round(data.times.reduce((a: number, b: number) => a + b, 0)),
        };
      }
    }
    return {
      name: step.functionName,
      gateCount: step.timings.gateCount ?? step.gateCount,
      witgenMs: Math.round(step.timings.witgen),
      oracles: Object.keys(oracleStats).length > 0 ? oracleStats : undefined,
    };
  });

  return {
    label,
    functions,
    totalMs: Math.round(elapsed),
    provingMs: result.stats?.timings?.proving
      ? Math.round(result.stats.timings.proving)
      : undefined,
    syncMs: result.stats?.timings?.sync
      ? Math.round(result.stats.timings.sync)
      : undefined,
  };
}

function printBenchmark(b: BenchmarkResult) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${b.label}`);
  console.log(`${"=".repeat(70)}`);
  console.log(`  Total profile time: ${b.totalMs}ms`);
  if (b.provingMs !== undefined) console.log(`  Proving time:       ${b.provingMs}ms`);
  if (b.syncMs !== undefined) console.log(`  Sync time:          ${b.syncMs}ms`);
  console.log();

  // Table header
  console.log(
    "  " +
      "Function".padEnd(50) +
      "Gates".padStart(12) +
      "Witgen".padStart(10),
  );
  console.log("  " + "-".repeat(72));

  let totalGates = 0;
  for (const fn of b.functions) {
    const gates = fn.gateCount !== undefined ? fn.gateCount.toLocaleString() : "N/A";
    if (fn.gateCount) totalGates += fn.gateCount;
    console.log(
      "  " +
        fn.name.padEnd(50) +
        gates.padStart(12) +
        `${fn.witgenMs}ms`.padStart(10),
    );
    if (fn.oracles) {
      for (const [name, data] of Object.entries(fn.oracles)) {
        console.log(
          "    " +
            `oracle: ${name}`.padEnd(46) +
            `${data.calls}x`.padStart(8) +
            `${data.totalMs}ms`.padStart(10),
        );
      }
    }
  }
  console.log("  " + "-".repeat(72));
  console.log("  " + "TOTAL GATES".padEnd(50) + totalGates.toLocaleString().padStart(12));
}

function printSummaryTable(results: BenchmarkResult[]) {
  console.log(`\n\n${"#".repeat(70)}`);
  console.log("  BENCHMARK SUMMARY");
  console.log(`${"#".repeat(70)}\n`);

  console.log(
    "  " +
      "Operation".padEnd(40) +
      "Gates".padStart(12) +
      "Functions".padStart(12) +
      "Time".padStart(10),
  );
  console.log("  " + "-".repeat(74));

  for (const r of results) {
    const totalGates = r.functions.reduce(
      (sum, f) => sum + (f.gateCount ?? 0),
      0,
    );
    console.log(
      "  " +
        r.label.padEnd(40) +
        totalGates.toLocaleString().padStart(12) +
        r.functions.length.toString().padStart(12) +
        `${r.totalMs}ms`.padStart(10),
    );
  }
  console.log();
}

async function main() {
  console.log("=== Primus zkTLS Airdrop - Benchmarks ===\n");

  // Setup
  console.log(`Connecting to Aztec node at ${NODE_URL}...`);
  const aztecNode = await createAztecNodeClient(NODE_URL);
  const sponsoredFPC = await getSponsoredFPCInstance();
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);
  const wallet = await EmbeddedWallet.create(aztecNode, { ephemeral: true });
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact);

  console.log("Creating account...");
  const accountManager = await wallet.createSchnorrAccount(Fr.random(), Fr.random());
  await (await accountManager.getDeployMethod()).send({
    from: NO_FROM,
    fee: { paymentMethod },
  });
  const accounts = await wallet.getAccounts();
  const account = accounts[0].item;
  console.log(`Account: ${account.toString()}`);

  const sendOpts = { from: account, fee: { paymentMethod } };
  const urlHashes = await computeAllowedUrlHashes(DEFAULT_ALLOWED_URLS);
  const results: BenchmarkResult[] = [];

  // ---- Benchmark 1: Deploy PrimusAirdrop ----
  console.log("\nProfiling: Deploy PrimusAirdrop...");
  const airdropDeploy = PrimusAirdropContract.deploy(
    wallet,
    account,
    urlHashes as unknown as FieldLike[],
    AIRDROP_AMOUNT,
  );
  const airdropProfile = await profileInteraction(airdropDeploy, sendOpts, "Deploy PrimusAirdrop");
  results.push(airdropProfile);
  printBenchmark(airdropProfile);

  // Actually deploy it
  const { contract: airdrop } = await airdropDeploy.send(sendOpts);
  console.log(`  Deployed at: ${airdrop.address.toString()}`);

  // ---- Benchmark 2: Deploy Token ----
  console.log("\nProfiling: Deploy Token...");
  const tokenDeploy = TokenContract.deployWithOpts<"constructor_with_minter">(
    { method: "constructor_with_minter", wallet },
    "Primus Airdrop Token",
    "PRIMUS",
    18,
    airdrop.address,
  );
  const tokenProfile = await profileInteraction(tokenDeploy, sendOpts, "Deploy Token");
  results.push(tokenProfile);
  printBenchmark(tokenProfile);

  const { contract: token } = await tokenDeploy.send(sendOpts);
  console.log(`  Deployed at: ${token.address.toString()}`);

  // ---- Benchmark 3: set_token ----
  console.log("\nProfiling: set_token...");
  const setTokenInteraction = airdrop.methods.set_token(token.address);
  const setTokenProfile = await profileInteraction(setTokenInteraction, sendOpts, "set_token");
  results.push(setTokenProfile);
  printBenchmark(setTokenProfile);

  await setTokenInteraction.send(sendOpts);

  // ---- Benchmark 4: claim (the main event) ----
  const attestationPath = "testdata/attestation.json";
  const fs = await import("fs");
  if (!fs.existsSync(attestationPath)) {
    console.log("\nSkipping claim benchmark: no attestation file.");
  } else {
    console.log("\nProfiling: claim (zkTLS attestation + nullifier + token mint)...");
    const parsed = parseAttestationFile(attestationPath, DEFAULT_ALLOWED_URLS);

    const claimInteraction = airdrop.methods.claim(
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
    );

    const claimProfile = await profileInteraction(claimInteraction, sendOpts, "claim (full zkTLS verification)");
    results.push(claimProfile);
    printBenchmark(claimProfile);
  }

  // ---- Summary ----
  printSummaryTable(results);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
