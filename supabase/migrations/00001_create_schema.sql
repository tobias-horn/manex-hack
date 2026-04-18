-- Manex Hackathon schema.
-- Strict subset of production: 19 tables (PROCESS_PARAMETER excluded).
-- All IDs are TEXT with prefix conventions for human readability.
-- All FKs use ON DELETE RESTRICT to prevent cascading deletes.

BEGIN;

-- ============================================================
-- Roles (created before tables so GRANTs can reference them)
-- ============================================================

-- authenticator: PostgREST connects as this. NOINHERIT + SET ROLE dance.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
END $$;

-- anon: default role PostgREST uses when no JWT is present, or JWT has role=anon
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;

-- seed_readonly: read-only on all seed tables. Base role for protection.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seed_readonly') THEN
    CREATE ROLE seed_readonly NOLOGIN;
  END IF;
END $$;

-- team_writer: inherits seed_readonly, adds writes on workflow tables + CREATE.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'team_writer') THEN
    CREATE ROLE team_writer NOLOGIN;
  END IF;
END $$;

GRANT seed_readonly TO team_writer;
-- authenticator must be able to SET ROLE to anon and team_writer
GRANT anon TO authenticator;
GRANT team_writer TO authenticator;
-- NOTE: anon intentionally has NO data access. Unauthenticated requests
-- (or requests with invalid JWT signatures) fall back to anon and get empty
-- responses / 401. Valid per-team JWTs (role=team_writer, signed with the
-- team's unique JWT_SECRET) are the only path to read/write data. This is
-- what isolates teams from each other.

-- ============================================================
-- Factory hierarchy
-- ============================================================

CREATE TABLE factory (
  factory_id    TEXT PRIMARY KEY CHECK (factory_id ~ '^FAC-[0-9]{5}$'),
  name          TEXT NOT NULL,
  country       TEXT,
  site_code     TEXT
);

CREATE TABLE line (
  line_id       TEXT PRIMARY KEY CHECK (line_id ~ '^LIN-[0-9]{5}$'),
  factory_id    TEXT NOT NULL REFERENCES factory(factory_id) ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  line_type     TEXT,
  area          TEXT
);

CREATE TABLE section (
  section_id    TEXT PRIMARY KEY CHECK (section_id ~ '^SEC-[0-9]{5}$'),
  line_id       TEXT NOT NULL REFERENCES line(line_id) ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  section_type  TEXT,
  sequence_no   INTEGER
);

-- ============================================================
-- Product catalog: article + configuration + BOM
-- ============================================================

CREATE TABLE article (
  article_id    TEXT PRIMARY KEY CHECK (article_id ~ '^ART-[0-9]{5}$'),
  name          TEXT NOT NULL
);

CREATE TABLE configuration (
  configuration_id    TEXT PRIMARY KEY CHECK (configuration_id ~ '^CFG-[0-9]{5}$'),
  article_id          TEXT NOT NULL REFERENCES article(article_id) ON DELETE RESTRICT,
  configuration_code  TEXT,
  title               TEXT,
  market              TEXT,
  revision            TEXT,
  valid_from          DATE,
  valid_to            DATE,
  notes               TEXT
);

CREATE TABLE bom (
  bom_id              TEXT PRIMARY KEY CHECK (bom_id ~ '^BOM-[0-9]{5}$'),
  article_id          TEXT NOT NULL REFERENCES article(article_id) ON DELETE RESTRICT,
  configuration_id    TEXT REFERENCES configuration(configuration_id) ON DELETE RESTRICT,
  bom_version         TEXT,
  status              TEXT,
  valid_from          DATE,
  valid_to            DATE,
  notes               TEXT
);

-- ============================================================
-- Parts: master data, batches, instances
-- ============================================================

CREATE TABLE part_master (
  part_number     TEXT PRIMARY KEY CHECK (part_number ~ '^PM-[0-9]{5}$'),
  title           TEXT NOT NULL,
  commodity       TEXT,
  drawing_number  TEXT,
  revision        TEXT,
  uom             TEXT,
  notes           TEXT
);

-- BOM_NODE created after PART_MASTER because it references it.
-- Self-reference parent_bom_node_id is deferred via ALTER TABLE below.
CREATE TABLE bom_node (
  bom_node_id           TEXT PRIMARY KEY CHECK (bom_node_id ~ '^BN-[0-9]{5}$'),
  bom_id                TEXT NOT NULL REFERENCES bom(bom_id) ON DELETE RESTRICT,
  parent_bom_node_id    TEXT,
  part_number           TEXT REFERENCES part_master(part_number) ON DELETE RESTRICT,
  qty                   NUMERIC(10,3),
  node_type             TEXT CHECK (node_type IN ('assembly', 'component')),
  find_number           TEXT
);

ALTER TABLE bom_node
  ADD CONSTRAINT bom_node_parent_fk
  FOREIGN KEY (parent_bom_node_id) REFERENCES bom_node(bom_node_id) ON DELETE RESTRICT;

CREATE TABLE supplier_batch (
  batch_id        TEXT PRIMARY KEY CHECK (batch_id ~ '^SB-[0-9]{5}$'),
  part_number     TEXT NOT NULL REFERENCES part_master(part_number) ON DELETE RESTRICT,
  batch_number    TEXT,
  supplier_name   TEXT,
  supplier_id     TEXT,
  received_date   DATE,
  qty             INTEGER
);

CREATE TABLE part (
  part_id             TEXT PRIMARY KEY CHECK (part_id ~ '^P-[0-9]{6}$'),
  part_number         TEXT NOT NULL REFERENCES part_master(part_number) ON DELETE RESTRICT,
  batch_id            TEXT REFERENCES supplier_batch(batch_id) ON DELETE RESTRICT,
  serial_number       TEXT,
  created_ts          TIMESTAMPTZ,
  status              TEXT,
  manufacturer_name   TEXT,
  quality_status      TEXT,
  notes               TEXT
);

-- ============================================================
-- Production: orders + products + part installations
-- ============================================================

CREATE TABLE production_order (
  order_id            TEXT PRIMARY KEY CHECK (order_id ~ '^PO-[0-9]{5}$'),
  article_id          TEXT NOT NULL REFERENCES article(article_id) ON DELETE RESTRICT,
  configuration_id    TEXT REFERENCES configuration(configuration_id) ON DELETE RESTRICT,
  planned_date        DATE
);

CREATE TABLE product (
  product_id          TEXT PRIMARY KEY CHECK (product_id ~ '^PRD-[0-9]{5}$'),
  article_id          TEXT NOT NULL REFERENCES article(article_id) ON DELETE RESTRICT,
  configuration_id    TEXT REFERENCES configuration(configuration_id) ON DELETE RESTRICT,
  bom_id              TEXT REFERENCES bom(bom_id) ON DELETE RESTRICT,
  order_id            TEXT REFERENCES production_order(order_id) ON DELETE RESTRICT,
  build_ts            TIMESTAMPTZ
);

CREATE TABLE product_part_install (
  install_id             TEXT PRIMARY KEY CHECK (install_id ~ '^PPI-[0-9]{6}$'),
  product_id             TEXT NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT,
  part_id                TEXT NOT NULL REFERENCES part(part_id) ON DELETE RESTRICT,
  bom_node_id            TEXT REFERENCES bom_node(bom_node_id) ON DELETE RESTRICT,
  installed_section_id   TEXT REFERENCES section(section_id) ON DELETE RESTRICT,
  qty                    NUMERIC(10,3),
  position_code          TEXT,
  installed_ts           TIMESTAMPTZ,
  user_id                TEXT
);

-- ============================================================
-- Testing
-- ============================================================

CREATE TABLE test (
  test_id         TEXT PRIMARY KEY CHECK (test_id ~ '^TST-[0-9]{5}$'),
  section_id      TEXT REFERENCES section(section_id) ON DELETE RESTRICT,
  part_number     TEXT REFERENCES part_master(part_number) ON DELETE RESTRICT,
  title           TEXT NOT NULL,
  test_location   TEXT,
  test_type       TEXT,
  lower_limit     NUMERIC(12,4),
  upper_limit     NUMERIC(12,4),
  image_url       TEXT,
  notes           TEXT
);

CREATE TABLE test_result (
  test_result_id    TEXT PRIMARY KEY CHECK (test_result_id ~ '^TR-[0-9]{6}$'),
  test_run_id       TEXT,
  test_id           TEXT NOT NULL REFERENCES test(test_id) ON DELETE RESTRICT,
  product_id        TEXT NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT,
  section_id        TEXT REFERENCES section(section_id) ON DELETE RESTRICT,
  ts                TIMESTAMPTZ,
  test_time_ms      INTEGER,
  overall_result    TEXT CHECK (overall_result IN ('PASS', 'FAIL', 'MARGINAL')),
  test_key          TEXT,
  test_value        TEXT,
  unit              TEXT,
  notes             TEXT
);

-- ============================================================
-- Quality domain: defects, claims, rework, actions
-- ============================================================

CREATE TABLE defect (
  defect_id                   TEXT PRIMARY KEY CHECK (defect_id ~ '^DEF-[0-9]{5}$'),
  product_id                  TEXT NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT,
  ts                          TIMESTAMPTZ,
  source_type                 TEXT,
  defect_code                 TEXT,
  severity                    TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  detected_section_id         TEXT REFERENCES section(section_id) ON DELETE RESTRICT,
  occurrence_section_id       TEXT REFERENCES section(section_id) ON DELETE RESTRICT,
  detected_test_result_id     TEXT REFERENCES test_result(test_result_id) ON DELETE RESTRICT,
  reported_part_number        TEXT REFERENCES part_master(part_number) ON DELETE RESTRICT,
  image_url                   TEXT,
  cost                        NUMERIC(10,2),
  notes                       TEXT
);

CREATE TABLE field_claim (
  field_claim_id          TEXT PRIMARY KEY CHECK (field_claim_id ~ '^FC-[0-9]{5}$'),
  product_id              TEXT NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT,
  claim_ts                TIMESTAMPTZ,
  market                  TEXT,
  complaint_text          TEXT,
  reported_part_number    TEXT REFERENCES part_master(part_number) ON DELETE RESTRICT,
  image_url               TEXT,
  cost                    NUMERIC(10,2),
  detected_section_id     TEXT REFERENCES section(section_id) ON DELETE RESTRICT,
  mapped_defect_id        TEXT REFERENCES defect(defect_id) ON DELETE RESTRICT,
  notes                   TEXT
);

CREATE TABLE rework (
  rework_id              TEXT PRIMARY KEY CHECK (rework_id ~ '^RW-[0-9]{5}$'),
  defect_id              TEXT NOT NULL REFERENCES defect(defect_id) ON DELETE RESTRICT,
  product_id             TEXT NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT,
  ts                     TIMESTAMPTZ,
  rework_section_id      TEXT REFERENCES section(section_id) ON DELETE RESTRICT,
  action_text            TEXT,
  reported_part_number   TEXT REFERENCES part_master(part_number) ON DELETE RESTRICT,
  user_id                TEXT,
  image_url              TEXT,
  time_minutes           INTEGER,
  cost                   NUMERIC(10,2)
);

CREATE TABLE product_action (
  action_id       TEXT PRIMARY KEY CHECK (action_id ~ '^PA-[0-9]{5}$'),
  product_id      TEXT NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT,
  ts              TIMESTAMPTZ,
  action_type     TEXT,
  status          TEXT,
  user_id         TEXT,
  section_id      TEXT REFERENCES section(section_id) ON DELETE RESTRICT,
  comments        TEXT,
  defect_id       TEXT REFERENCES defect(defect_id) ON DELETE RESTRICT
);

-- ============================================================
-- Indexes for hot query paths
-- ============================================================

CREATE INDEX idx_defect_product              ON defect(product_id);
CREATE INDEX idx_defect_ts                   ON defect(ts);
CREATE INDEX idx_defect_code                 ON defect(defect_code);
CREATE INDEX idx_defect_detected_section     ON defect(detected_section_id);
CREATE INDEX idx_defect_part                 ON defect(reported_part_number);
CREATE INDEX idx_defect_severity             ON defect(severity);

CREATE INDEX idx_test_result_product         ON test_result(product_id);
CREATE INDEX idx_test_result_test            ON test_result(test_id);
CREATE INDEX idx_test_result_ts              ON test_result(ts);
CREATE INDEX idx_test_result_overall         ON test_result(overall_result);

CREATE INDEX idx_field_claim_ts              ON field_claim(claim_ts);
CREATE INDEX idx_field_claim_product         ON field_claim(product_id);
CREATE INDEX idx_field_claim_part            ON field_claim(reported_part_number);

CREATE INDEX idx_product_article             ON product(article_id);
CREATE INDEX idx_product_build_ts            ON product(build_ts);
CREATE INDEX idx_product_order               ON product(order_id);

CREATE INDEX idx_ppi_product                 ON product_part_install(product_id);
CREATE INDEX idx_ppi_part                    ON product_part_install(part_id);
CREATE INDEX idx_ppi_bom_node                ON product_part_install(bom_node_id);
CREATE INDEX idx_ppi_section                 ON product_part_install(installed_section_id);

CREATE INDEX idx_part_batch                  ON part(batch_id);
CREATE INDEX idx_part_part_number            ON part(part_number);

CREATE INDEX idx_bom_node_parent             ON bom_node(parent_bom_node_id);
CREATE INDEX idx_bom_node_bom                ON bom_node(bom_id);
CREATE INDEX idx_bom_node_part               ON bom_node(part_number);

CREATE INDEX idx_supplier_batch_part         ON supplier_batch(part_number);
CREATE INDEX idx_supplier_batch_received     ON supplier_batch(received_date);

CREATE INDEX idx_rework_defect               ON rework(defect_id);
CREATE INDEX idx_rework_product              ON rework(product_id);
CREATE INDEX idx_rework_user                 ON rework(user_id);

CREATE INDEX idx_product_action_defect       ON product_action(defect_id);
CREATE INDEX idx_product_action_product      ON product_action(product_id);
CREATE INDEX idx_product_action_status       ON product_action(status);
CREATE INDEX idx_product_action_user         ON product_action(user_id);

-- ============================================================
-- Permissions: seed_readonly on all seed tables
-- ============================================================

-- anon gets USAGE on schema only (for OpenAPI introspection shell), no SELECT
GRANT USAGE ON SCHEMA public TO seed_readonly, team_writer, anon;

GRANT SELECT ON
  factory, line, section, article, configuration, bom, bom_node,
  part_master, supplier_batch, part, production_order, product,
  product_part_install, test, test_result, defect, field_claim
TO seed_readonly;

-- team_writer gets writes ONLY on workflow tables
GRANT SELECT, INSERT, UPDATE, DELETE ON product_action TO team_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON rework         TO team_writer;

-- Allow team_writer to CREATE TABLE in public (custom FMEA/fault-tree tables etc.)
GRANT CREATE ON SCHEMA public TO team_writer;

-- Grant SEQUENCE USAGE to team_writer (future-proof for serial columns teams add)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO team_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO team_writer;

-- Tables/views teams create themselves: grant write to team_writer by default
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO team_writer;

COMMIT;
