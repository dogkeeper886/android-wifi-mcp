/**
 * Phase 0b — initial structured-logging schema. See issue #51.
 * Field naming follows OTel conventions where applicable so future export
 * to an OTel collector is mechanical.
 */

exports.up = (pgm) => {
  // tool_calls — written via raw SQL so duration_ms can be a stored generated
  // column (node-pg-migrate's high-level API silently drops the generated clause).
  pgm.sql(`
    CREATE TABLE tool_calls (
      call_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id       uuid,
      parent_call_id uuid,
      session_id     text,
      connection_id  text,
      client_info    jsonb,
      tool_name      text        NOT NULL,
      surface        text        NOT NULL,
      args           jsonb,
      result         jsonb,
      error          jsonb,
      started_at     timestamptz NOT NULL DEFAULT now(),
      completed_at   timestamptz,
      duration_ms    integer GENERATED ALWAYS AS
        ((EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::int) STORED
    );
  `);
  pgm.createIndex('tool_calls', 'trace_id');
  pgm.createIndex('tool_calls', 'session_id');
  pgm.createIndex('tool_calls', 'started_at');
  pgm.createIndex('tool_calls', 'tool_name');

  pgm.createTable('device_events', {
    event_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    trace_id: { type: 'uuid', notNull: false },
    layer: { type: 'text', notNull: true },
    serial: { type: 'text', notNull: false },
    state: { type: 'text', notNull: false },
    raw: { type: 'jsonb', notNull: false },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('device_events', 'serial');
  pgm.createIndex('device_events', 'occurred_at');
  pgm.createIndex('device_events', 'trace_id');

  pgm.createTable('sessions', {
    session_id: { type: 'text', primaryKey: true },
    client_info: { type: 'jsonb', notNull: false },
    selected_serial: { type: 'text', notNull: false },
    upstream_ctx_map: { type: 'jsonb', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_active_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('sessions', 'last_active_at');
};

exports.down = (pgm) => {
  pgm.dropTable('sessions');
  pgm.dropTable('device_events');
  pgm.sql('DROP TABLE tool_calls;');
};
