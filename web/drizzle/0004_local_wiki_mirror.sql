ALTER TABLE `clips` ADD `local_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `mirror_version` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `mirror_updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE TABLE `wiki_sync_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_wiki_sync_tokens_hash` ON `wiki_sync_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_wiki_sync_tokens_owner` ON `wiki_sync_tokens` (`owner_id`);
