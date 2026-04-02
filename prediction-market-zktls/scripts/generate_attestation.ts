/**
 * generate_attestation.ts
 *
 * Generates a Primus zkTLS attestation proving the current BTC/USD price
 * from CoinGecko's public API.
 *
 * Uses @primuslabs/zktls-core-sdk (PrimusCoreTLS).
 *
 * Both response resolves extract the same price value to satisfy
 * att_verifier_lib's requirement of exactly 2 items.
 *
 * Usage:
 *   PRIMUS_APP_ID=xxx PRIMUS_APP_SECRET=yyy npx tsx scripts/generate_attestation.ts
 *
 * Or with .env:
 *   npx tsx scripts/generate_attestation.ts
 */

import fs from "fs";
import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname });

async function main() {
  const appId = process.env.PRIMUS_APP_ID;
  const appSecret = process.env.PRIMUS_APP_SECRET;
  if (!appId || !appSecret) {
    console.error("PRIMUS_APP_ID and PRIMUS_APP_SECRET must be set in .env");
    process.exit(1);
  }

  // Use createRequire since the core SDK is a CommonJS module
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const { PrimusCoreTLS } = require("@primuslabs/zktls-core-sdk");

  console.log("Generating zkTLS attestation for BTC/USD price from CoinGecko...\n");

  // Initialize the Primus zkTLS client
  const zkTLS = new PrimusCoreTLS();
  const initResult = await zkTLS.init(appId, appSecret);
  console.log("Init result:", initResult);

  // CoinGecko simple price API
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

  const request = {
    url,
    method: "GET",
    header: {
      Accept: "application/json",
      "User-Agent": "PrimusZKTLS",
    },
    body: "",
  };

  // Extract the BTC/USD price. Both resolves extract the same value to satisfy
  // att_verifier_lib's NUM_RESPONSE_RESOLVE=2 requirement.
  // CoinGecko response format: {"bitcoin":{"usd":97234.56}}
  const responseResolves = [
    {
      keyName: "price",
      parsePath: "$.bitcoin.usd",
      op: "SHA256_EX",
    },
    {
      keyName: "price_confirm",
      parsePath: "$.bitcoin.usd",
      op: "SHA256_EX",
    },
  ];

  // Generate attestation request
  const generateRequest = zkTLS.generateRequestParams(
    request,
    responseResolves,
  );

  // Use MPC TLS mode: client and attester collaboratively compute the
  // attestation so neither party sees the full TLS key material alone,
  // reducing trust in the attester compared to proxy TLS.
  generateRequest.setAttMode({
    algorithmType: "mpctls",
  });

  console.log("Starting attestation process...");

  // Generate the attestation via the Primus network
  const attestation = await zkTLS.startAttestation(generateRequest);
  console.log("Attestation received!");

  // Verify locally
  const verifyResult = zkTLS.verifyAttestation(attestation);
  console.log(`Local verification: ${verifyResult ? "PASS" : "FAIL"}`);

  if (!verifyResult) {
    console.error("Attestation verification failed!");
    process.exit(1);
  }

  // Save the attestation
  const outputPath = "testdata/attestation.json";
  fs.mkdirSync("testdata", { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(attestation, null, 2));

  // Print the attested price
  const dataObj = JSON.parse(attestation.data);
  console.log(`\nAttested BTC/USD price: $${dataObj["price"]}`);
  console.log(`Attestation saved to ${outputPath}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
