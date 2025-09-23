This proves note hash delivery

Prerequisites:
aztec-up @ 2.0.3

Steps:
1. aztec-nargo compile in circuits/
2. aztec-nargo compile in sample-contract
3. aztec-postprocess-contract in sample-contract
4. yarn codegen in scripts
4. yarn copy-target in scripts
5. aztec start --sandbox in terminal 2
6. yarn start in scripts
7. copy details outputted by step 6
8. yarn dev in vite
9. paste details copied in step 7 to the frontend started by step 8
