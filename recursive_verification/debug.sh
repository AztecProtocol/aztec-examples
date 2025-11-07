#!/bin/bash

cd recursive_verification
bun install
bash -i <(curl -s https://install.aztec.network)
aztec-up 3.0.0-devnet.4
docker tag aztecprotocol/aztec:3.0.0-devnet.4 aztecprotocol/aztec:latest
cd circuit && aztec-nargo compile && aztec-nargo execute && cd ..
bun data
bun ccc
aztec start --sandbox &
bun recursion:debug
docker container kill $(docker ps | awk '/aztec-start/ {print $1}')