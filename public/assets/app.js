(function () {
  "use strict";

  var path = window.location.pathname;
  var navToday = document.getElementById("nav-today");
  var navPeople = document.getElementById("nav-people");
  var navVehicles = document.getElementById("nav-vehicles");
  var navHealth = document.getElementById("nav-health");
  var navEvents = document.getElementById("nav-events");
  var navCalendar = document.getElementById("nav-calendar");

  if (path.startsWith("/today") && navToday) {
    navToday.classList.add("active");
  } else if (path.startsWith("/people") && navPeople) {
    navPeople.classList.add("active");
  } else if ((path.startsWith("/vehicles") || path.startsWith("/vehicle-events")) && navVehicles) {
    navVehicles.classList.add("active");
  } else if (path.startsWith("/health") && navHealth) {
    navHealth.classList.add("active");
  } else if (path.startsWith("/events") && navEvents) {
    navEvents.classList.add("active");
  } else if (navCalendar) {
    navCalendar.classList.add("active");
  }

  var personFilter = document.getElementById("person-filter");
  if (personFilter) {
    personFilter.addEventListener("change", function () {
      var basePath = personFilter.getAttribute("data-base-path") || window.location.pathname;
      var extraName = personFilter.getAttribute("data-extra-param") || "";
      var extraValue = personFilter.getAttribute("data-extra-value") || "";
      var params = new URLSearchParams();
      if (extraName) {
        params.set(extraName, extraValue);
      }
      if (personFilter.value) {
        params.set("person", personFilter.value);
      }
      window.location.href = basePath + "?" + params.toString();
    });
  }

  var plateFilter = document.getElementById("plate-filter");
  if (plateFilter) {
    plateFilter.addEventListener("change", function () {
      var basePath = plateFilter.getAttribute("data-base-path") || window.location.pathname;
      var extraName = plateFilter.getAttribute("data-extra-param") || "";
      var extraValue = plateFilter.getAttribute("data-extra-value") || "";
      var params = new URLSearchParams();
      if (extraName) {
        params.set(extraName, extraValue);
      }
      if (plateFilter.value) {
        params.set("plate", plateFilter.value);
      }
      window.location.href = basePath + "?" + params.toString();
    });
  }

  var dateSelect = document.getElementById("date-select");
  if (dateSelect) {
    dateSelect.addEventListener("change", function () {
      var params = new URLSearchParams(window.location.search);
      if (dateSelect.value) {
        params.set("date", dateSelect.value);
      } else {
        params.delete("date");
      }
      window.location.href = window.location.pathname + "?" + params.toString();
    });
  }
})();
