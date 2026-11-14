import { useState } from "react";
import { api } from "../api";
import Button from "./Button";
import Icon from "./Icon";

// A list the patient keeps themselves (allergies or medicines). `kind` is "allergies" or "medications".
export default function SelfList({ kind, items, setItems, nameLabel, extraLabel, extraKey, empty }) {
  const [name, setName] = useState("");
  const [extra, setExtra] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const item = await api.addMyHealthItem(kind, { name, extra });
      setItems([...items, item]);
      setName(""); setExtra("");
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  async function remove(id) {
    setErr("");
    try { await api.removeMyHealthItem(kind, id); setItems(items.filter((x) => x.id !== id)); } catch (x) { setErr(x.message); }
  }

  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? <p className="m-0 text-sm text-muted">{empty}</p> : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 rounded-2xl bg-soft px-4 py-3">
              <span className="text-sm"><b>{x.name}</b>{x[extraKey] ? ` · ${x[extraKey]}` : ""}</span>
              <button type="button" onClick={() => remove(x.id)} aria-label={`Remove ${x.name}`} className="flex h-11 w-11 flex-none items-center justify-center rounded-full hover:bg-white">
                <Icon name="x" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} noValidate className="flex flex-col gap-3 border-t border-line pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`sl-${kind}-n`} className="text-[13px] font-semibold">{nameLabel}</label>
            <input id={`sl-${kind}-n`} className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`sl-${kind}-e`} className="text-[13px] font-semibold">{extraLabel} (optional)</label>
            <input id={`sl-${kind}-e`} className="field" value={extra} onChange={(e) => setExtra(e.target.value)} autoComplete="off" />
          </div>
        </div>
        {err && <p role="alert" className="m-0 text-sm font-medium text-risk-high-bg">{err}</p>}
        <Button type="submit" variant="outline" disabled={busy} className="self-start">{busy ? "Adding..." : "Add"}</Button>
      </form>
    </div>
  );
}
