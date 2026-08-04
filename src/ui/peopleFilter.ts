import { PersonSummary } from "../types.js";
import { escapeHtml } from "./html.js";

/**
 * Builds a query string preserving an existing param and optionally adding person.
 */
export function buildPersonQueryString(
  extraParamName: string,
  extraParamValue: string,
  selectedPerson?: string
): string {
  const params = new URLSearchParams();
  params.set(extraParamName, extraParamValue);
  if (selectedPerson) {
    params.set("person", selectedPerson);
  }
  return params.toString();
}

/**
 * Renders a styled person-selector dropdown that navigates on change,
 * preserving the current month/date param. Change handling lives in /assets/app.js.
 */
export function renderPeopleFilter(
  people: PersonSummary[],
  selectedPerson: string | undefined,
  basePath: string,
  extraParamName: string,
  extraParamValue: string
): string {
  const options = [
    `<option value=""${!selectedPerson ? " selected" : ""}>All People</option>`,
    ...people.map((p) => {
      const selected =
        selectedPerson && p.person_name.toLowerCase() === selectedPerson.toLowerCase()
          ? " selected"
          : "";
      const label = `${escapeHtml(p.person_name)} (${p.event_count})`;
      return `<option value="${escapeHtml(p.person_name)}"${selected}>${label}</option>`;
    }),
  ].join("");

  return `
    <div class="people-filter">
      <label for="person-filter" class="people-filter-label">Person</label>
      <select
        id="person-filter"
        class="people-filter-select"
        data-base-path="${escapeHtml(basePath)}"
        data-extra-param="${escapeHtml(extraParamName)}"
        data-extra-value="${escapeHtml(extraParamValue)}"
      >
        ${options}
      </select>
    </div>
  `;
}
