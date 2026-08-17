Priority	User journey	Current coverage	Missing proof 3	Authentication onboarding	/login only tests cancellation; /logout
only tests having no credentials.	Successful login → provider/model selection → first message, persisted credentials,
real logout, and failed-auth recovery. 4	Session resume	/resume only tests “no recent sessions.”	Select a real session,
restore history/Agent/model/Plan state, send another message, and survive corrupt or interrupted sessions. 5	Real
compaction	/compact only tests “Nothing to compact.”	Compact a populated conversation, verify the summary/context, then
continue successfully without losing Agent/model/workflow state. 6	Init recovery	Successful startup init and
already-initialized behavior are covered.	User declines, Init Agent fails, artifact is missing, retry succeeds, and
partial initialization is recovered safely. 7	Settings persistence	/settings only selects “Done”; /theme changes the
current selection.	Actually edit each important setting, verify immediate behavior, restart the application, and verify
persistence. 8	Agent/model restart persistence	The new scenarios prove precedence and subsequent messages within one
process.	Restart/resume the session and prove the manual model and selected Agent remain effective. 9	Slash-command
happy paths	/share only tests missing gh; /copy only tests no assistant message.	Successful sharing and copying, plus
their real failure/retry paths. 10	Validation branch precision	Broad validation and repair coverage is
extensive.	Independently prove objective:none versus objective:all-pass, and human-review:none versus
human-review:ask-skip; they currently share scenarios.
