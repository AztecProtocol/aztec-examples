#!/bin/bash

rm -rf contract/artifacts contract/codegenCache.json ~/.bb/00000000.00000000.00000000/vk_cache ivc
yarn install
aztec-up 5.0.0-rc.1
cd circuit && aztec-nargo compile && aztec-nargo execute && cd ..
yarn data
yarn ccc
