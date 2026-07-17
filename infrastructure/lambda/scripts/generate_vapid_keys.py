"""
One-time utility: generate a VAPID keypair for Web Push.

Run: python infrastructure/lambda/scripts/generate_vapid_keys.py

Prints two values:
  VAPID_PRIVATE_KEY — set as the Lambda's env var (via `VAPID_PRIVATE_KEY=... cdk deploy`),
                       never commit this.
  VAPID_PUBLIC_KEY  — safe to commit; paste into
                       src/app/services/queue-push.service.ts.
"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def main():
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    private_raw = private_key.private_numbers().private_value.to_bytes(32, 'big')
    public_raw = public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )

    print(f'VAPID_PRIVATE_KEY={b64url(private_raw)}')
    print(f'VAPID_PUBLIC_KEY={b64url(public_raw)}')


if __name__ == '__main__':
    main()
