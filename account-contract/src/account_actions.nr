use aztec::context::PrivateContext;

use aztec::protocol::{
    constants::DOM_SEP__TX_NULLIFIER, hash::poseidon2_hash_with_separator, traits::Hash,
};

use aztec::authwit::auth::{compute_authwit_message_hash, IS_VALID_SELECTOR};
use aztec::authwit::entrypoint::app::AppPayload;

pub struct AccountActions<Context> {
    context: Context,
    is_valid_impl: fn(&mut PrivateContext, Field, Field) -> bool,
}

impl<Context> AccountActions<Context> {
    pub fn init(context: Context, is_valid_impl: fn(&mut PrivateContext, Field, Field) -> bool) -> Self {
        AccountActions { context, is_valid_impl }
    }
}

// See AccountFeePaymentMethodOptions enum in Aztec.js for docs:
// https://github.com/AztecProtocol/aztec-packages/blob/next/yarn-project/entrypoints/src/account_entrypoint.ts
pub struct AccountFeePaymentMethodOptionsEnum {
    pub EXTERNAL: u8,
    pub PREEXISTING_FEE_JUICE: u8,
    pub FEE_JUICE_WITH_CLAIM: u8,
}

pub global AccountFeePaymentMethodOptions: AccountFeePaymentMethodOptionsEnum = AccountFeePaymentMethodOptionsEnum {
    EXTERNAL: 0,
    PREEXISTING_FEE_JUICE: 1,
    FEE_JUICE_WITH_CLAIM: 2,
};

impl AccountActions<&mut PrivateContext> {

    pub fn entrypoint(self, app_payload: AppPayload, fee_payment_method: u8, cancellable: bool, password: Field) {
        let valid_fn = self.is_valid_impl;

        assert(valid_fn(self.context, app_payload.hash(), password));

        if fee_payment_method == AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE {
            self.context.set_as_fee_payer();
            self.context.end_setup();
        }
        if fee_payment_method == AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM {
            self.context.set_as_fee_payer();
        }
        app_payload.execute_calls(self.context);

        if cancellable {
            let tx_nullifier = poseidon2_hash_with_separator(
                [app_payload.tx_nonce],
                DOM_SEP__TX_NULLIFIER,
            );
            self.context.push_nullifier(tx_nullifier);
        }
    }

    pub fn verify_private_authwit(self, inner_hash: Field, password: Field) -> Field {
        let message_hash = compute_authwit_message_hash(
            self.context.maybe_msg_sender().unwrap(),
            self.context.chain_id(),
            self.context.version(),
            inner_hash,
        );
        let valid_fn = self.is_valid_impl;
        assert(valid_fn(self.context, message_hash, password), "Message not authorized by account");
        IS_VALID_SELECTOR
    }
}
