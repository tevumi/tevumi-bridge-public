"""Strict ABI and receipt proof for the two supported native-USDC/WOTR swaps."""
import re

WOTR = '0x70cedd901366ad932203bbb08b22dcd4d4510028'
ROUTER = '0x4fca4a51ab4f23a7447b3284fbd7d73289a89fb1'
MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951'
POOL_ID = '0x0b98404b6f6df1c01ecb4a44b8c7e0c11b722585f91c5bc77dc9e7d294d278b4'
SWAP = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f'


def word(value):
    return value.to_bytes(32, 'big')


def dynamic(value):
    return word(len(value)) + value + b'\0' * (-len(value) % 32)


def array(values):
    offset = len(values) * 32
    heads, tails = [], []
    for value in values:
        part = dynamic(value)
        heads.append(word(offset))
        tails.append(part)
        offset += len(part)
    return word(len(values)) + b''.join(heads + tails)


def encode_plan(reverse, amount, minimum, deadline):
    """Canonical encoding; also used to reject extra commands and recipients."""
    swap = b''.join(word(v) for v in (32, 0, int(WOTR, 16), 3000, 60, 0,
                                      int(reverse), amount, minimum, 288, 0))
    settle = word(0 if reverse else int(WOTR, 16)) + word(amount)
    take = word(int(WOTR, 16) if reverse else 0) + word(minimum)
    actions = dynamic(bytes.fromhex('060c0f'))
    payload = word(64) + word(64 + len(actions)) + actions + array([swap, settle, take])
    commands = dynamic(b'\x10')
    return '0x3593564c' + (word(96) + word(96 + len(commands)) + word(deadline)
                            + commands + array([payload])).hex()


def inspect_input(tx):
    text = tx.get('input', '').lower()
    if not re.fullmatch(r'0x3593564c[0-9a-f]+', text) or len(text) > 8192:
        raise ValueError('Swap route mismatch')
    raw = bytes.fromhex(text[10:])

    def number(offset):
        if offset < 0 or offset % 32 or offset + 32 > len(raw):
            raise ValueError('Swap ABI offset mismatch')
        return int.from_bytes(raw[offset:offset + 32], 'big')

    try:
        inputs = number(32)
        if number(inputs) != 1:
            raise ValueError('Swap input count mismatch')
        payload_length = inputs + 32 + number(inputs + 32)
        payload = payload_length + 32
        params = payload + number(payload + 32)
        if number(params) != 3:
            raise ValueError('Swap action count mismatch')
        swap_length = params + 32 + number(params + 32)
        swap = swap_length + 32
        struct = swap + number(swap)
        reverse = number(struct + 160)
        amount, minimum = number(struct + 192), number(struct + 224)
        if reverse not in (0, 1) or not 0 < amount < 2**128 or not 0 < minimum < 2**128:
            raise ValueError('Swap amount or direction mismatch')
        if text != encode_plan(bool(reverse), amount, minimum, number(64)):
            raise ValueError('Swap route mismatch')
        if int(tx.get('value', '0x0'), 16) != (amount if reverse else 0):
            raise ValueError('Swap native payment mismatch')
        return bool(reverse), amount, minimum
    except (OverflowError, IndexError, TypeError) as error:
        raise ValueError('Swap ABI mismatch') from error


def receipt_output(receipt, reverse, amount, minimum):
    events = [log for log in receipt.get('logs', [])
              if log.get('address', '').lower() == MANAGER
              and len(log.get('topics', [])) == 3
              and log['topics'][0].lower() == SWAP
              and log['topics'][1].lower() == POOL_ID
              and int(log['topics'][2], 16) == int(ROUTER, 16)]
    if len(events) != 1:
        raise ValueError('Swap receipt has no unique matching pool event')
    data = events[0].get('data', '')
    if not re.fullmatch(r'0x[0-9a-fA-F]{384}', data):
        raise ValueError('Swap event data mismatch')
    deltas = [int.from_bytes(bytes.fromhex(data[i:i+64]), 'big', signed=True)
              for i in (2, 66)]
    spent, received = (-deltas[0], deltas[1]) if reverse else (-deltas[1], deltas[0])
    if spent != amount or received < minimum or received <= 0:
        raise ValueError('Swap event amounts mismatch')
    return received
