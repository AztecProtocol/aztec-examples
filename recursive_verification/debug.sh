#!/bin/bash

rm -rf contract/artifacts contract/codegenCache.json ~/.bb/00000000.00000000.00000000/vk_cache ivc
bun install
bash -i <(curl -s https://install.aztec.network) 
aztec-up 3.0.0-devnet.4
docker tag aztecprotocol/aztec:3.0.0-devnet.4 aztecprotocol/aztec:latest
cd circuit && aztec-nargo compile && aztec-nargo execute && cd ..
bun data
bun ccc