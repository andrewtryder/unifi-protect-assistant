-- Remove Better Auth tables (immutable history remains in 0004_better_auth.sql).
-- Child-first order; no application tables reference these.

DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS account;
DROP TABLE IF EXISTS verification;
DROP TABLE IF EXISTS user;
