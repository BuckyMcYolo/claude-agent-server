#!/usr/bin/env python3
"""
Initialize client context for Row-Level Security.

This script writes the client_id to a protected config file that
db_connect.py reads to enforce row-level security on all database queries.

Usage:
    python init_client.py <client_id>

This is called automatically by the system before any user queries.
The config file is stored outside the workspace so Claude cannot modify it.
"""

import sys
from pathlib import Path

# Protected config directory (outside workspace - Claude cannot modify)
CONFIG_DIR = Path.home() / ".agent-config"
CLIENT_ID_FILE = CONFIG_DIR / "client_id"


def init_client(client_id: str) -> None:
    """
    Initialize the client context by writing client_id to protected config.

    Args:
        client_id: The client ID for row-level security filtering
    """
    if not client_id or not client_id.strip():
        print("ERROR: client_id cannot be empty", file=sys.stderr)
        sys.exit(1)

    # Ensure config directory exists
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    # Write client_id to protected file
    CLIENT_ID_FILE.write_text(client_id.strip())

    # Lock down permissions (readable only by owner)
    CLIENT_ID_FILE.chmod(0o600)

    print(f"✓ Client context initialized: {client_id[:8]}...")


def get_current_client_id() -> str | None:
    """
    Get the currently configured client_id, if any.

    Returns:
        The client_id string, or None if not configured
    """
    if not CLIENT_ID_FILE.exists():
        return None
    return CLIENT_ID_FILE.read_text().strip() or None


def clear_client() -> None:
    """
    Clear the client context (for cleanup/testing).
    """
    if CLIENT_ID_FILE.exists():
        CLIENT_ID_FILE.unlink()
        print("✓ Client context cleared")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python init_client.py <client_id>", file=sys.stderr)
        print("       python init_client.py --clear", file=sys.stderr)
        print("       python init_client.py --show", file=sys.stderr)
        sys.exit(1)

    arg = sys.argv[1]

    if arg == "--clear":
        clear_client()
    elif arg == "--show":
        current = get_current_client_id()
        if current:
            print(f"Current client_id: {current}")
        else:
            print("No client_id configured")
    else:
        init_client(arg)
