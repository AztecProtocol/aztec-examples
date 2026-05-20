use aztec::macros::aztec;

mod account_actions;

#[aztec]
pub contract PasswordAccount {
    use aztec::{
        authwit::{
            auth::compute_authwit_nullifier,
            entrypoint::app::AppPayload,
        },
        context::PrivateContext,
        hash::compute_siloed_nullifier,
        macros::{functions::{external, initializer, only_self, noinitcheck, view}, storage::storage},
        oracle::get_nullifier_membership_witness::get_low_nullifier_membership_witness,
        protocol::{address::AztecAddress, hash::poseidon2_hash},
        state_vars::PublicImmutable,
    };

    use crate::account_actions::AccountActions;

    #[storage]
    struct Storage<Context> {
        hashed_password: PublicImmutable<Field, Context>,
    }

    // Constructs the contract
    #[external("private")]
    #[initializer]
    fn constructor(password: Field) {
        let hashed_password = poseidon2_hash([password]);
        self.enqueue_self.set_hashed_password(hashed_password);
    }

    #[external("public")]
    #[only_self]
    fn set_hashed_password(hashed_password: Field) {
        self.storage.hashed_password.initialize(hashed_password);
    }

    // @dev: If you globally change the entrypoint signature don't forget to update account_entrypoint.ts file (specifically `getEntrypointAbi()`).
    // using noinitcheck is an optimization, it reduces gates by omitting a check that the contract has been initialized
    #[external("private")]
    #[noinitcheck]
    fn entrypoint(app_payload: AppPayload, fee_payment_method: u8, cancellable: bool, password: Field) {
        let actions = AccountActions::init(self.context, is_valid_impl);
        actions.entrypoint(app_payload, fee_payment_method, cancellable, password);
    }

    #[external("private")]
    #[noinitcheck]
    #[view]
    fn verify_private_authwit(inner_hash: Field, password: Field) -> Field {
        let actions = AccountActions::init(self.context, is_valid_impl);
        actions.verify_private_authwit(inner_hash, password)
    }

    #[contract_library_method]
    fn is_valid_impl(context: &mut PrivateContext, _outer_hash: Field, password: Field) -> bool {
        let storage = Storage::init(context);

        let hashed_password_from_account = storage.hashed_password.read();

        let hashed_password = poseidon2_hash([password]);

        hashed_password_from_account == hashed_password
    }

    /**
    * @notice Helper function to check validity of private authwitnesses
    * @param consumer The address of the consumer of the message
    * @param message_hash The message hash of the message to check the validity
    * @return True if the message_hash can be consumed, false otherwise
    */
    #[external("utility")]
    unconstrained fn lookup_validity(consumer: AztecAddress, inner_hash: Field, password: Field) -> bool {
        let hashed_password_from_account = self.storage.hashed_password.read();

        let hashed_password = poseidon2_hash([password]);

        let valid_in_private = hashed_password_from_account == hashed_password;

        // Compute the nullifier and check if it is spent
        // This will BLINDLY TRUST the oracle, but the oracle is us, and
        // it is not as part of execution of the contract, so we are good.
        let nullifier = compute_authwit_nullifier(self.address, inner_hash);
        let siloed_nullifier = compute_siloed_nullifier(consumer, nullifier);
        let (leaf_preimage, _witness) =
            get_low_nullifier_membership_witness(self.context.block_header(), siloed_nullifier);
        let is_spent = leaf_preimage.nullifier == siloed_nullifier;

        !is_spent & valid_in_private
    }
}
