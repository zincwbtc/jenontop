CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`http_status` integer,
	`created` integer NOT NULL
);
