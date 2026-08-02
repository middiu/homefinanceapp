CREATE TABLE `ai_categorization_log` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text,
	`batch_id` text,
	`description` text,
	`suggested_category_id` text,
	`applied` integer DEFAULT false NOT NULL,
	`rule_created_or_updated_id` text,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_connection_test_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`outcome` text NOT NULL,
	`latency_ms` integer,
	`error_category` text
);
--> statement-breakpoint
CREATE TABLE `category_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`monthly_amount` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `forecast_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`generated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`scope` text NOT NULL,
	`horizon_months` integer DEFAULT 12 NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `investment_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`ticker` text NOT NULL,
	`purchase_date` text NOT NULL,
	`quantity` real NOT NULL,
	`purchase_price` real NOT NULL,
	`fees` real,
	`import_batch_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `price_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`price` real NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`snapshot_date` text NOT NULL,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seed_rules_applied` (
	`seed_version` text PRIMARY KEY NOT NULL,
	`applied_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`must_reset_password` integer DEFAULT true NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`last_login_at` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`is_custom` integer DEFAULT false NOT NULL,
	`type` text,
	`essential` integer
);
--> statement-breakpoint
INSERT INTO `__new_categories`("id", "name", "parent_id", "is_custom", "type", "essential") SELECT "id", "name", "parent_id", "is_custom", "type", "essential" FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `accounts` ADD `linked_repayment_account_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `credit_limit` real;--> statement-breakpoint
ALTER TABLE `accounts` ADD `statement_closing_day` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `payment_due_day` integer;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `ai_categorized_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `rule_source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `updated_from_ai_at` text;--> statement-breakpoint
ALTER TABLE `rules` ADD `seed_version` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `time` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `linked_transaction_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `needs_review` integer DEFAULT false NOT NULL;