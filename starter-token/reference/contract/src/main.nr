use aztec::macros::aztec;

#[aztec]
pub contract StarterToken {
  use aztec::macros::{
    functions::{initializer, private, public, utility, internal},
    storage::storage,
  };
  use aztec::state_vars::{PublicMutable, Map};
  use aztec::protocol_types::address::AztecAddress;

  use easy_private_state::EasyPrivateUint;

  #[storage]
  struct Storage<Context> {
    owner: PublicMutable<AztecAddress, Context>,
    balances: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
    // ===============
    private_balances: Map<AztecAddress, EasyPrivateUint<Context>, Context>
  }

  #[initializer]
  #[public]
  fn setup() {
    // The deployer becomes the owner
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

    assert(sender_balance >= amount, "Insufficient balance");

    storage.balances.at(sender).write(sender_balance - amount);

    let recipient_balance = storage.balances.at(to).read();
    storage.balances.at(to).write(recipient_balance + amount);
  }

  #[public]
  fn transfer_ownership(new_owner: AztecAddress) {
    assert_eq(context.msg_sender(), storage.owner.read());
    storage.owner.write(new_owner);
  }

  // ===============

  #[private]
  fn mint_private(to: AztecAddress, amount: u64) {
    // Enqueue public validation
    StarterToken::at(context.this_address())._assert_is_owner(context.msg_sender()).enqueue(&mut context);

    storage.private_balances.at(to).add(amount, to);
  }

  #[private]
  fn transfer_private(to: AztecAddress, amount: u64) {
    let sender = context.msg_sender();

    storage.private_balances.at(sender).sub(amount, sender);

    storage.private_balances.at(to).add(amount, to);
  }

  #[utility]
  unconstrained fn view_private_balance(owner: AztecAddress) -> Field {
    storage.private_balances.at(owner).get_value()
  }

  #[public]
  #[internal]
  fn _assert_is_owner(maybe_owner: AztecAddress) {
    assert_eq(maybe_owner, storage.owner.read());
  }
}
