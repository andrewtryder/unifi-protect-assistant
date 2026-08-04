(function () {
  "use strict";

  var tz = "America/New_York";

  function formatTime(ms) {
    return new Date(ms).toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  function formatAge(ms, nowMs) {
    if (ms == null) return "never";
    var seconds = Math.max(0, Math.floor((nowMs - ms) / 1000));
    if (seconds < 60) return seconds + "s ago";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m ago";
    var hours = Math.floor(minutes / 60);
    if (hours < 48) return hours + "h ago";
    return Math.floor(hours / 24) + "d ago";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function peopleHtml(snapshot) {
    if (!snapshot.people.length) {
      return '<tr><td colspan="7" class="empty-cell">No one seen yet today.</td></tr>';
    }
    return snapshot.people
      .map(function (p) {
        var statusClass = p.status === "present" ? "badge-accent" : "badge";
        var statusLabel = p.status === "present" ? "Present" : "Away";
        var href = "/people/" + encodeURIComponent(p.person_key);
        return (
          "<tr>" +
          '<td><a href="' +
          href +
          '" class="row-link">' +
          escapeHtml(p.person_name) +
          "</a></td>" +
          '<td><span class="badge ' +
          statusClass +
          '">' +
          statusLabel +
          "</span></td>" +
          "<td>" +
          formatTime(p.first_seen_ms) +
          "</td>" +
          "<td>" +
          formatTime(p.last_seen_ms) +
          "</td>" +
          '<td><code class="muted-code">' +
          escapeHtml(p.last_camera_id) +
          "</code></td>" +
          "<td>" +
          p.observed_rounded_hours +
          'h <span class="muted-sm">(' +
          p.session_count +
          " sess)</span></td>" +
          "<td>" +
          p.sighting_count +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function streamHtml(snapshot) {
    if (!snapshot.recent_events.length) {
      return '<tr><td colspan="4" class="empty-cell">No events yet today.</td></tr>';
    }
    return snapshot.recent_events
      .map(function (e) {
        return (
          "<tr>" +
          "<td>" +
          formatTime(e.seen_at_ms) +
          "</td>" +
          "<td>" +
          escapeHtml(e.person_name) +
          "</td>" +
          '<td><code class="muted-code">' +
          escapeHtml(e.camera_id) +
          "</code></td>" +
          '<td><span class="badge">' +
          escapeHtml(e.trigger_key) +
          "</span></td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function applySnapshot(snapshot) {
    var present = document.querySelector('[data-field="present_count"]');
    var seen = document.querySelector('[data-field="seen_today_count"]');
    var unknown = document.querySelector('[data-field="unknown_face_count"]');
    var eventsHour = document.querySelector('[data-field="events_last_hour"]');
    var statusEl = document.querySelector('[data-field="webhook_status"]');
    var webhookSub = document.querySelector('[data-field="webhook_sub"]');
    var peopleBody = document.getElementById("people-tbody");
    var streamBody = document.getElementById("stream-tbody");
    var todayDate = document.getElementById("today-date");
    var updatedAt = document.getElementById("updated-at");

    if (!present || !peopleBody || !streamBody) return;

    present.textContent = snapshot.present_count;
    if (seen) seen.textContent = snapshot.seen_today_count;
    if (unknown) unknown.textContent = snapshot.unknown_face_count;
    if (eventsHour) eventsHour.textContent = snapshot.events_last_hour;
    if (statusEl) {
      statusEl.textContent = snapshot.webhook.healthy ? "Healthy" : "Stale / quiet";
      statusEl.className = "badge " + (snapshot.webhook.healthy ? "badge-accent" : "badge");
    }
    if (webhookSub) {
      webhookSub.textContent =
        "Last " +
        formatAge(snapshot.webhook.last_received_at_ms, snapshot.generated_at_ms) +
        " · " +
        snapshot.webhook.count_last_hour +
        " in last hour";
    }
    peopleBody.innerHTML = peopleHtml(snapshot);
    streamBody.innerHTML = streamHtml(snapshot);
    if (todayDate) todayDate.textContent = snapshot.local_date + " · America/New_York";
    if (updatedAt) updatedAt.textContent = formatTime(snapshot.generated_at_ms);
  }

  async function poll() {
    try {
      var res = await fetch("/api/today", { credentials: "include" });
      if (!res.ok) return;
      var data = await res.json();
      applySnapshot(data);
    } catch (e) {
      /* keep last good frame */
    }
  }

  poll();
  setInterval(poll, 15000);
})();
