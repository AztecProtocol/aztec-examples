use aztec::macros::aztec;

#[aztec]
pub contract StarterToken {
    use aztec::{
        state_vars::public_mutable::PublicMutable, map::Map,
        macros::{
            functions::{initializer, public},
            storage::storage,
        },
        protocol_types::address::AztecAddress
    };

    #[storage]
    struct Storage<Context> {
        balances: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        owner: PublicMutable<AztecAddress, Context>,
    }

    #[initializer]
    #[public]
    fn setup() {
        // The deployer (msg_sender) becomes the owner
        storage.owner.write(context.msg_sender());
    }

    #[public]
    fn mint(to: AztecAddress, amount: u128) {
        assert_eq(context.msg_sender(), storage.owner.read());

        let recipient_balance = storage.balances.at(to).read();

        storage.balances.at(to).write(recipient_balance + amount);
    }

    #[public]
    fn transfer(to: AztecAddress, amount: u128) {
        let sender = context.msg_sender();

        let sender_balance = storage.balances.at(sender).read();

        assert(sender_balance >= amount, "Cannot transfer more than the balance of the user");

        storage.balances.at(sender).write(sender_balance - amount);

        let recipient_balance = storage.balances.at(to).read();

        storage.balances.at(to).write(recipient_balance + amount);
    }

    #[public]
    fn transfer_ownership(new_owner: AztecAddress) {
        let maybe_contract_owner = context.msg_sender();

        assert_eq(context.msg_sender(), storage.owner.read());

        storage.owner.write(new_owner);
    }
}
