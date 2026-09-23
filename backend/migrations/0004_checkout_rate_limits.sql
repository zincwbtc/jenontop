CREATE TABLE checkout_rate_limits (
  key text PRIMARY KEY NOT NULL,
  attempts integer NOT NULL,
  bucket integer NOT NULL
);
