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
 * preserving the current month/date param.
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
      <select id="person-filter" class="people-filter-select" onchange="onPersonFilterChange(this)">
        ${options}
      </select>
    </div>
    <script>
      function onPersonFilterChange(select) {
        const params = new URLSearchParams();
        params.set(${JSON.stringify(extraParamName)}, ${JSON.stringify(extraParamValue)});
        if (select.value) {
          params.set("person", select.value);
        }
        window.location.href = ${JSON.stringify(basePath)} + "?" + params.toString();
      }
    </script>
  `;
}

export const peopleFilterStyles = `
  .people-filter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .people-filter-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .people-filter-select {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    font-family: var(--font);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    min-width: 180px;
    transition: all 0.2s ease;
  }
  .people-filter-select:hover {
    border-color: var(--border-strong);
  }
  .people-filter-select:focus {
    border-color: var(--accent);
    outline: none;
  }
`;
