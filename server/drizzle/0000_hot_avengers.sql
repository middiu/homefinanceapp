CREATE TABLE `account_ownership` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`member_id` text NOT NULL,
	`percentage` real NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`institution` text,
	`type` text NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`opening_balance` real DEFAULT 0 NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`generated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`type` text NOT NULL,
	`scope` text NOT NULL,
	`content` text NOT NULL,
	`related_period` text
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`is_custom` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`file_name` text NOT NULL,
	`file_format` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `import_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`account_id` text,
	`format` text NOT NULL,
	`column_map` text NOT NULL,
	`has_header` integer DEFAULT true NOT NULL,
	`date_format` text,
	`amount_sign_convention` text DEFAULT 'auto' NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`match_type` text NOT NULL,
	`match_value` text NOT NULL,
	`amount_min` real,
	`amount_max` real,
	`category_id` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`raw_description` text,
	`amount` real NOT NULL,
	`balance` real,
	`category_id` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`import_batch_id` text,
	`is_transfer` integer DEFAULT false NOT NULL,
	`dedup_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE set null
);
