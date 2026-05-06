on run
	try
		do shell script "/Users/haily/Desktop/CLAUDE/Strava/sync-all.sh > /tmp/strava-sync.log 2>&1"
		display notification "Latest activities + sleep loaded. Dashboard opening." with title "Strava Sync" sound name "Glass"
	on error errMsg number errNum
		display alert "Sync failed" message errMsg & return & return & "Full log: /tmp/strava-sync.log" as warning
	end try
end run
