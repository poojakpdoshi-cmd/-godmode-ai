CREATE TABLE `executionEvents` (
	`id` varchar(36) NOT NULL,
	`missionId` varchar(36) NOT NULL,
	`runId` varchar(36),
	`userId` int NOT NULL,
	`type` varchar(80) NOT NULL,
	`level` enum('info','success','warning','error') NOT NULL,
	`summary` varchar(300) NOT NULL,
	`detail` text,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `executionEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `executionRuns` (
	`id` varchar(36) NOT NULL,
	`missionId` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`providerId` varchar(64) NOT NULL,
	`modelId` varchar(255) NOT NULL,
	`mode` enum('solo','competition') NOT NULL,
	`status` enum('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
	`output` text,
	`errorCode` varchar(80),
	`errorMessage` text,
	`latencyMs` int,
	`promptTokens` int,
	`completionTokens` int,
	`totalTokens` int,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `executionRuns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `missionMessages` (
	`id` varchar(36) NOT NULL,
	`missionId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`role` enum('user','system','assistant') NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `missionMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `missions` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`command` text NOT NULL,
	`systemPrompt` text,
	`mode` enum('solo','competition') NOT NULL,
	`status` enum('draft','queued','running','completed','partial','failed') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `missions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `providerConfigurations` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`providerId` varchar(64) NOT NULL,
	`displayName` varchar(120) NOT NULL,
	`credentialSource` enum('platform','environment') NOT NULL,
	`isEnabled` enum('yes','no') NOT NULL DEFAULT 'yes',
	`lastCheckedAt` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `providerConfigurations_id` PRIMARY KEY(`id`),
	CONSTRAINT `provider_configs_user_provider_uq` UNIQUE(`userId`,`providerId`)
);
--> statement-breakpoint
ALTER TABLE `executionEvents` ADD CONSTRAINT `executionEvents_missionId_missions_id_fk` FOREIGN KEY (`missionId`) REFERENCES `missions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `executionEvents` ADD CONSTRAINT `executionEvents_runId_executionRuns_id_fk` FOREIGN KEY (`runId`) REFERENCES `executionRuns`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `executionEvents` ADD CONSTRAINT `executionEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `executionRuns` ADD CONSTRAINT `executionRuns_missionId_missions_id_fk` FOREIGN KEY (`missionId`) REFERENCES `missions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `executionRuns` ADD CONSTRAINT `executionRuns_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `executionRuns` ADD CONSTRAINT `executionRuns_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missionMessages` ADD CONSTRAINT `missionMessages_missionId_missions_id_fk` FOREIGN KEY (`missionId`) REFERENCES `missions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missionMessages` ADD CONSTRAINT `missionMessages_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missions` ADD CONSTRAINT `missions_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missions` ADD CONSTRAINT `missions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `providerConfigurations` ADD CONSTRAINT `providerConfigurations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `events_mission_created_idx` ON `executionEvents` (`missionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `events_run_created_idx` ON `executionEvents` (`runId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `runs_mission_created_idx` ON `executionRuns` (`missionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `runs_user_created_idx` ON `executionRuns` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `mission_messages_mission_created_idx` ON `missionMessages` (`missionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `missions_user_created_idx` ON `missions` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `missions_project_created_idx` ON `missions` (`projectId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `projects_user_created_idx` ON `projects` (`userId`,`createdAt`);