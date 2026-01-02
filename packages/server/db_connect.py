"""
Secure database connection module for multi-tenant data access.

This module wraps database connections and automatically enforces
Row-Level Security by setting the client_id session variable.

The client_id is read from a protected file that Claude cannot modify.

Usage:
    from db_connect import get_connection, get_engine

    # Using psycopg2
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders LIMIT 100")

    # Using SQLAlchemy
    engine = get_engine()
    df = pd.read_sql("SELECT * FROM orders LIMIT 100", engine)
"""

import os
from functools import lru_cache
from pathlib import Path

# Protected config file location (outside workspace - Claude cannot modify)
CLIENT_ID_FILE = Path.home() / ".agent-config" / "client_id"


def get_client_id() -> str:
    """
    Read the client_id from the protected config file.

    Raises:
        RuntimeError: If client_id file doesn't exist or is empty
    """
    if not CLIENT_ID_FILE.exists():
        raise RuntimeError(
            "Client ID not configured. This is a server configuration error."
        )

    client_id = CLIENT_ID_FILE.read_text().strip()

    if not client_id:
        raise RuntimeError("Client ID is empty. This is a server configuration error.")

    return client_id


def get_connection():
    """
    Get a psycopg2 database connection with RLS client_id already set.

    The connection automatically has the app.current_client_id session
    variable set, so all queries are filtered by Row-Level Security.

    Returns:
        psycopg2 connection object

    Example:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM orders LIMIT 100")
        rows = cursor.fetchall()
    """
    import psycopg2

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL environment variable is not set")

    client_id = get_client_id()

    # Create connection
    conn = psycopg2.connect(database_url)

    # Set the client_id session variable for RLS
    cursor = conn.cursor()
    cursor.execute("SET app.current_client_id = %s", (client_id,))
    cursor.close()

    print(f"✓ Database connected with client_id: {client_id[:8]}...")

    return conn


@lru_cache(maxsize=1)
def get_engine():
    """
    Get a SQLAlchemy engine with RLS client_id set on each connection.

    Uses connection pooling with automatic client_id injection.

    Returns:
        SQLAlchemy Engine object

    Example:
        import pandas as pd
        engine = get_engine()
        df = pd.read_sql("SELECT * FROM orders LIMIT 100", engine)
    """
    from sqlalchemy import create_engine, event

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL environment variable is not set")

    client_id = get_client_id()

    engine = create_engine(database_url)

    # Set client_id on every new connection from the pool
    @event.listens_for(engine, "connect")
    def set_client_id(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("SET app.current_client_id = %s", (client_id,))
        cursor.close()

    print(f"✓ SQLAlchemy engine created with client_id: {client_id[:8]}...")

    return engine


def query_df(sql: str, params=None):
    """
    Execute a SQL query and return results as a pandas DataFrame.

    Convenience function that handles connection and RLS automatically.

    Args:
        sql: SQL query string
        params: Optional query parameters (dict or tuple)

    Returns:
        pandas DataFrame with query results

    Example:
        df = query_df("SELECT * FROM orders WHERE status = %(status)s", {"status": "completed"})
    """
    import pandas as pd

    engine = get_engine()
    return pd.read_sql(sql, engine, params=params)


# Print info on import
if __name__ != "__main__":
    try:
        client_id = get_client_id()
        print(f"ℹ️  db_connect loaded for client_id: {client_id[:8]}...")
    except RuntimeError:
        print("⚠️  db_connect loaded but client_id not yet configured")
