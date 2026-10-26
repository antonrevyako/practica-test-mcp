# Local practice archive

The app keeps the questions encountered in every opened test, including question text, illustrations, answer options in their original order and the answer key. An answer event records the selected option IDs, whether they were correct and when the selection was saved. Changed selections append events; submitting the same selection again leaves the original timestamp and event count unchanged.

SQLite keeps the latest choice separately for each question appearance. This allows both latest-answer accuracy and first-answer accuracy to be reported without losing earlier mistakes. Question keys are hashes of language, permit, wording, illustration URL and sorted option text, independent of shuffled letters. Each appearance retains its own option order and correct IDs.

## MCP tools

- `get_statistics`: totals, accuracy, per-language/category groups and image-cache counts. Filters: `permit`, `language`, `runId`, `questionKey`, `from`, `to`.
- `list_recorded_questions`: exact question wording and options, test title/source URL, last selected IDs, correctness, correct IDs after answering, and image availability. Adds `search`, `mistakesOnly`, `limit` and `offset`.
- `get_answer_history`: answer events with timestamps, chosen options, correct options and the full corresponding question. Adds `correct`, `limit` and `offset` to the common filters.
- `get_recorded_question_image`: returns MCP image content for a locally saved illustration using `runId` and `questionId`.
- `cache_recorded_images`: queues missing and failed illustrations for background download. Sign in first. Read progress from `get_statistics`.

`limit` defaults to 20 and is capped at 100. Use `offset` to read additional pages. Dates must be ISO timestamps with a timezone. Question and latest-answer summary counts use the time the question was recorded; answer-event counts and history use the time of each answer. `accuracyPercent` is null when there are no answers. The `images` summary covers the entire local image cache, independent of question filters.

Example requests:

```json
{"tool":"get_statistics","arguments":{"permit":"B","language":"en"}}
{"tool":"list_recorded_questions","arguments":{"mistakesOnly":true,"limit":20,"offset":0}}
{"tool":"get_answer_history","arguments":{"correct":false,"limit":20}}
```

The first four tools use local data and remain available without a PracticaTest session. They still require the normal MCP connection authentication. Correct option IDs remain hidden on unanswered question appearances; answer-history records include them because they represent answered questions.

## Images

Starting an attempt immediately queues all its question images. Downloads run independently of the remote-session queue and answer checking, with at most two active requests. Concurrent requests for the same URL share one download; existing files are reused after restart. Only supported PracticaTest question illustrations can be downloaded, with a maximum size of 5 MiB. A failed download leaves the question and answer history intact and can be retried.

Images use SHA-256 filenames and detected PNG, JPEG, WebP or GIF extensions. Files are written atomically with private permissions. By default they are saved to `data/images/`. With a custom `DATABASE_PATH`, the images directory sits next to that database. The default Docker `practica-data` volume preserves both SQLite and the image files.

`get_question_image` also uses the cache for an active test. `get_recorded_question_image` reads only the saved file, makes no network request and works after sign-out. A missing image returns a clear error; call `cache_recorded_images` after signing in and inspect the cache status.

## Existing data and deletion

Database migrations run automatically. Existing attempts and their last saved answers are imported into the archive once. Imported events have `origin=backfill`; new events have `origin=live`. Earlier answer changes that the previous version overwrote cannot be reconstructed. Signing in also queues images from existing attempts.

Credentials, cookies, CSRF tokens and remote tracking values are excluded from the archive. The `data/` directory is excluded from Git and the Docker build context. Signing out preserves the archive. Explicitly clearing practice history through the local API deletes attempts, question snapshots, answer events and saved images. No archive deletion tool is exposed over MCP.
