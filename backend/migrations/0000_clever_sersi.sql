CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`items` text NOT NULL,
	`total` integer NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`wallet` text,
	`payment` text,
	`created` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_payment_unique` ON `orders` (`payment`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`game` text NOT NULL,
	`rarity` text NOT NULL,
	`price` integer NOT NULL,
	`stock` integer NOT NULL,
	`image` text NOT NULL,
	`sample` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
