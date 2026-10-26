CREATE TABLE `answer_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`question_id` text NOT NULL,
	`option_ids` text NOT NULL,
	`correct` integer NOT NULL,
	`answered_at` text NOT NULL,
	`origin` text NOT NULL,
	FOREIGN KEY (`run_id`,`question_id`) REFERENCES `recorded_questions`(`run_id`,`question_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `answer_events_question_idx` ON `answer_events` (`run_id`,`question_id`,`id`);--> statement-breakpoint
CREATE INDEX `answer_events_time_idx` ON `answer_events` (`answered_at`,`id`);--> statement-breakpoint
CREATE TABLE `recorded_questions` (
	`run_id` text NOT NULL,
	`question_id` text NOT NULL,
	`question_key` text NOT NULL,
	`language` text NOT NULL,
	`permit` text NOT NULL,
	`question` text NOT NULL,
	`correct_option_ids` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `question_id`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recorded_questions_key_idx` ON `recorded_questions` (`question_key`);--> statement-breakpoint
CREATE INDEX `recorded_questions_language_permit_idx` ON `recorded_questions` (`language`,`permit`);