/*  Claude Bridge – dockable panel for After Effects
    ------------------------------------------------------------------
    Optional on macOS (the MCP server can drive AE through AppleScript),
    required on Windows. While this panel is open and "Listening", the
    MCP server drops jobs into a queue folder and the panel runs them.

    Install: copy this file into
      macOS:   /Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/
      Windows: C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\
    then restart AE and open Window > Claude Bridge.jsx
    Needs: Settings > Scripting & Expressions > "Allow Scripts to Write Files and Access Network".
*/
(function (thisObj) {
    var DIR = Folder.userData.fsName + "/AE Claude Bridge";
    var QUEUE = DIR + "/queue";
    var HEARTBEAT = DIR + "/listener.heartbeat";
    var POLL_MS = 300;

    function ensure(p) { var f = new Folder(p); if (!f.exists) f.create(); return f; }
    ensure(DIR); ensure(QUEUE);

    var ui = (thisObj instanceof Panel) ? thisObj : new Window("palette", "Claude Bridge", undefined, { resizeable: true });
    ui.orientation = "column"; ui.alignChildren = ["fill", "top"]; ui.margins = 10; ui.spacing = 6;
    var status = ui.add("statictext", undefined, "Stopped", { truncate: "end" });
    status.characters = 34;
    var row = ui.add("group");
    var bStart = row.add("button", undefined, "Start listening");
    var bStop = row.add("button", undefined, "Stop");
    var log = ui.add("listbox", undefined, [], { multiselect: false });
    log.preferredSize = [260, 140];
    var hint = ui.add("statictext", undefined, "Jobs: " + QUEUE, { truncate: "middle" });
    hint.characters = 34;

    function addLog(msg) {
        var d = new Date(), ts = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2);
        log.add("item", ts + "  " + msg, 0);
        while (log.items.length > 60) log.remove(log.items[log.items.length - 1]);
    }

    var beat = 0;
    $.global.ClaudeBridgePoll = function () {
        try {
            if (beat++ % 3 === 0) {
                var hb = new File(HEARTBEAT);
                hb.open("w"); hb.write(String(new Date().getTime())); hb.close();
            }
            var files = new Folder(QUEUE).getFiles("*.jsx");
            if (!files.length) return;
            files.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
            for (var i = 0; i < files.length; i++) {
                var f = files[i], name = f.name;
                var running = new File(f.fsName.replace(/\.jsx$/, ".running"));
                if (!f.rename(running.name)) continue;
                status.text = "Running " + name;
                try { $.evalFile(running); addLog("ran " + name); }
                catch (e) { addLog("ERROR " + name + ": " + e); }
                try { running.remove(); } catch (e2) {}
                status.text = "Listening";
            }
        } catch (err) { addLog("poll error: " + err); }
    };

    function start() {
        if ($.global.ClaudeBridgeTask) { try { app.cancelTask($.global.ClaudeBridgeTask); } catch (e) {} }
        $.global.ClaudeBridgeTask = app.scheduleTask("ClaudeBridgePoll()", POLL_MS, true);
        status.text = "Listening";
        addLog("listening on " + QUEUE);
    }
    function stop() {
        if ($.global.ClaudeBridgeTask) { try { app.cancelTask($.global.ClaudeBridgeTask); } catch (e) {} }
        $.global.ClaudeBridgeTask = null;
        try { new File(HEARTBEAT).remove(); } catch (e2) {}
        status.text = "Stopped";
        addLog("stopped");
    }
    bStart.onClick = start;
    bStop.onClick = stop;

    if (!app.preferences.getPrefAsLong("Main Pref Section", "Pref_SCRIPTING_FILE_NETWORK_SECURITY")) {
        addLog("Turn on: Settings > Scripting & Expressions > Allow Scripts to Write Files");
    }
    start();
    ui.onResizing = ui.onResize = function () { this.layout.resize(); };
    if (ui instanceof Window) { ui.center(); ui.show(); } else { ui.layout.layout(true); }
}(this));
