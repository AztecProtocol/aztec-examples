/**
 * generate_attestation.ts
 *
 * Generates a Primus zkTLS attestation proving that a GitHub user is a
 * contributor to a repository in the primus-labs organization.
 *
 * Uses @primuslabs/zktls-core-sdk (PrimusCoreTLS).
 *
 * Usage:
 *   PRIMUS_APP_ID=xxx PRIMUS_APP_SECRET=yyy npx tsx scripts/generate_attestation.ts <repo> <username>
 *
 * Example:
 *   PRIMUS_APP_ID=0x... PRIMUS_APP_SECRET=0x... npx tsx scripts/generate_attestation.ts zktls-js-sdk fksyuan
 */

import fs from "fs";
import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname });

async function main() {
  const repo = process.argv[2];
  const username = process.argv[3];

  if (!repo || !username) {
    console.error(
      "Usage: npx tsx scripts/generate_attestation.ts <repo> <username>",
    );
    console.error(
      "Example: npx tsx scripts/generate_attestation.ts zktls-js-sdk fksyuan",
    );
    process.exit(1);
  }

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

  console.log(
    `Generating zkTLS attestation for ${username} on primus-labs/${repo}...\n`,
  );

  // Initialize the Primus zkTLS client
  const zkTLS = new PrimusCoreTLS();
  const initResult = await zkTLS.init(appId, appSecret);
  console.log("Init result:", initResult);

  // GitHub API request for contributors
  const url = `https://api.github.com/repos/primus-labs/${repo}/contributors?per_page=100&page=1`;

  const request = {
    url,
    method: "GET",
    header: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "PrimusZKTLS",
    },
    body: "",
  };

  // Extract the contributor's login and ID using JSONPath.
  // We search for the specific user in the contributors array.
  const responseResolves = [
    {
      keyName: "username",
      parsePath: `$.[?(@.login=='${username}')].login`,
      op: "SHA256_EX", // Hash the response value — required by att_verifier_lib
    },
    {
      keyName: "contributor-id",
      parsePath: `$.[?(@.login=='${username}')].id`,
      op: "SHA256_EX",
    },
  ];

  // Generate attestation request
  const generateRequest = zkTLS.generateRequestParams(
    request,
    responseResolves,
  );

  // Use proxy TLS mode
  generateRequest.setAttMode({
    algorithmType: "proxytls",
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

  console.log(`\nAttestation saved to ${outputPath}`);
  console.log(`\nAttestation data keys:`, Object.keys(attestation));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
