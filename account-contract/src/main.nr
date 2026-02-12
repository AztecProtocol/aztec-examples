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
        oracle::{
            get_nullifier_membership_witness::get_low_nullifier_membership_witness,
            notes::{get_sender_for_tags, set_sender_for_tags},
        },
        protocol::{address::AztecAddress, hash::poseidon2_hash},
        state_vars::PublicImmutable,
    };

    use crate::account_actions::AccountActions;

    #[storage]
    struct Storage<Context> {
        hashed_password: PublicImmutable<Field, Context>,
    }

    #[external("private")]
    #[initializer]
    fn constructor(password: Field) {
        let hashed_password = poseidon2_hash([password]);
        self.enqueue_self.set_hashed_password(hashed_password);

        // Safety: The sender for tags is only used to compute unconstrained shared secrets for emitting logs.
        let original_sender = unsafe { get_sender_for_tags().unwrap_or(self.address) };

        // Safety: Comment from above applies here as well.
        unsafe { set_sender_for_tags(self.address) };

        // Safety: Comment from above applies here as well.
        unsafe { set_sender_for_tags(original_sender) };
    }

    #[external("public")]
    #[only_self]
    fn set_hashed_password(hashed_password: Field) {
        self.storage.hashed_password.initialize(hashed_password);
    }

    #[external("private")]
    #[noinitcheck]
    fn entrypoint(app_payload: AppPayload, fee_payment_method: u8, cancellable: bool, password: Field) {
        // Safety: The sender for tags is only used to compute unconstrained shared secrets for emitting logs.
        unsafe { set_sender_for_tags(self.address) };

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

    #[external("utility")]
    unconstrained fn lookup_validity(consumer: AztecAddress, inner_hash: Field, password: Field) -> bool {
        let hashed_password_from_account = self.storage.hashed_password.read();

        let hashed_password = poseidon2_hash([password]);

        let valid_in_private = hashed_password_from_account == hashed_password;

        let nullifier = compute_authwit_nullifier(self.address, inner_hash);
        let siloed_nullifier = compute_siloed_nullifier(consumer, nullifier);
        let lower_wit =
            get_low_nullifier_membership_witness(self.context.block_header(), siloed_nullifier);
        let is_spent = lower_wit.leaf_preimage.nullifier == siloed_nullifier;

        !is_spent & valid_in_private
    }
}
