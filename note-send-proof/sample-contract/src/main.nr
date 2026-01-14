use aztec::macros::aztec;

#[aztec]
pub contract GettingStarted {
    use aztec::{
        state_vars::{PublicMutable, Owned},
        messages::message_delivery::MessageDelivery,

        macros::{
            functions::{initializer, external},
            storage::storage,
        },
        protocol_types::address::AztecAddress,
    };

    use dep::balance_set::balance_set::BalanceSet;

    #[storage]
    struct Storage<Context> {
        user_balances: Owned<BalanceSet<Context>, Context>,
        owner: PublicMutable<AztecAddress, Context>,
    }

    #[initializer]
    #[external("public")]
    fn setup(owner: AztecAddress) {
        self.storage.owner.write(owner);
    }

    #[external("private")]
    fn create_note_for_user(value: u128) {
        let note_owner = self.context.msg_sender().unwrap();
        self.storage.user_balances.at(note_owner).add(value)
            .deliver(MessageDelivery.UNCONSTRAINED_ONCHAIN);
    }

    #[external("utility")]
    unconstrained fn get_user_balance(owner: AztecAddress) -> u128 {
        self.storage.user_balances.at(owner).balance_of()
    }

    #[external("utility")]
    unconstrained fn get_owner() -> AztecAddress {
        self.storage.owner.read()
    }
}
