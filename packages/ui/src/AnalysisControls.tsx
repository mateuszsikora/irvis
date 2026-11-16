import { useState } from 'react';
import {
  celsiusToUnit,
  unitToCelsius,
  unitSymbol,
  type CorrectionSettings,
  type TemperatureUnit,
} from '@irvis/core';
import { type AnalysisSettings, type Measurement } from './measurements.ts';

export function AnalysisControls({
  value,
  onChange,
}: {
  value: AnalysisSettings;
  onChange: (value: AnalysisSettings) => void;
}) {
  const [nextId, setNextId] = useState(1);
  const [draft, setDraft] = useState([
    String(value.correction?.emissivity ?? 1),
    String(value.correction?.offsetKelvin ?? 0),
    String(value.correction?.reflectedCelsius ?? 25),
  ]);
  const [threshold, setThreshold] = useState(celsiusToUnit(value.threshold, value.unit).toFixed(1));
  const update = (patch: Partial<AnalysisSettings>) => onChange({ ...value, ...patch });
  const selected = value.objects.find((o) => o.id === value.selected);
  const valid =
    draft.every((v) => v.trim() !== '' && Number.isFinite(Number(v))) &&
    Number(draft[0]) >= 0.01 &&
    Number(draft[0]) <= 1 &&
    Number(draft[1]) >= -20 &&
    Number(draft[1]) <= 20 &&
    Number(draft[2]) >= -20 &&
    Number(draft[2]) <= 120;
  function commitCorrection() {
    const correction: CorrectionSettings = {
      emissivity: Number(draft[0]),
      offsetKelvin: Number(draft[1]),
      reflectedCelsius: Number(draft[2]),
    };
    update({ correction });
  }
  return (
    <section className="settings-section measurement-controls" aria-label="Measurements">
      <h3>Measurements</h3>
      <label>
        Temperature unit
        <select
          value={value.unit}
          onChange={(e) => {
            const unit = e.target.value as TemperatureUnit;
            setThreshold(celsiusToUnit(value.threshold, unit).toFixed(1));
            update({ unit });
          }}
        >
          {(['C', 'F', 'K'] as const).map((u) => (
            <option key={u} value={u}>
              {unitSymbol(u)}
            </option>
          ))}
        </select>
      </label>
      {(['Point', 'Line', 'Area'] as const).map((kind) => (
        <button
          key={kind}
          onClick={() => {
            update({
              objects: [...value.objects, { id: nextId, kind, x: 25, y: 25, x2: 75, y2: 75 }],
              selected: nextId,
            });
            setNextId(nextId + 1);
          }}
        >
          Add {kind.toLowerCase()}
        </button>
      ))}
      <button onClick={() => update({ objects: [], selected: null })}>Clear measurements</button>
      <label>
        Selected object
        <select
          value={value.selected ?? ''}
          onChange={(e) => update({ selected: Number(e.target.value) || null })}
        >
          <option value="">None</option>
          {value.objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.kind} {o.id}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <fieldset>
          <legend>
            Edit {selected.kind} {selected.id}
          </legend>
          <p>Position in percent of the image. Edit both ends to move a line or resize an area.</p>
          {(
            ['x', 'y', ...(selected.kind === 'Point' ? [] : ['x2', 'y2'])] as (keyof Pick<
              Measurement,
              'x' | 'y' | 'x2' | 'y2'
            >)[]
          ).map((key) => (
            <label key={key}>
              {key} (%)
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={selected[key]}
                onChange={(e) => {
                  const number = Number(e.target.value);
                  if (
                    e.target.value !== '' &&
                    Number.isFinite(number) &&
                    number >= 0 &&
                    number <= 100
                  )
                    update({
                      objects: value.objects.map((o) =>
                        o.id === selected.id ? { ...o, [key]: number } : o,
                      ),
                    });
                }}
              />
            </label>
          ))}
          <button
            onClick={() =>
              update({ objects: value.objects.filter((o) => o.id !== selected.id), selected: null })
            }
          >
            Delete selected
          </button>
        </fieldset>
      )}
      <label>
        <input
          type="checkbox"
          checked={value.highlight}
          onChange={(e) => update({ highlight: e.target.checked })}
        />
        Highlight selected area
      </label>
      <h3>Temperature alarm</h3>
      <label>
        High threshold ({unitSymbol(value.unit)})
        <input
          type="number"
          step="0.1"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </label>
      <button
        disabled={threshold.trim() === '' || !Number.isFinite(Number(threshold))}
        onClick={() =>
          update({ threshold: unitToCelsius(Number(Number(threshold).toFixed(1)), value.unit) })
        }
      >
        Apply threshold
      </button>
      <label>
        <input
          type="checkbox"
          checked={value.alarm}
          onChange={(e) => update({ alarm: e.target.checked })}
        />
        Enable alarm
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.isotherm}
          onChange={(e) => update({ isotherm: e.target.checked })}
        />
        Isotherm above threshold
      </label>
      <h3>Host correction</h3>
      <p>
        {value.correction
          ? 'Host correction applied relative to recorded camera state.'
          : 'Using camera correction unchanged.'}
      </p>
      {['Emissivity', 'Offset (°C)', 'Reflected temperature (°C)'].map((label, i) => (
        <label key={label}>
          {label}
          <input
            type="number"
            step={i === 0 ? '.01' : '.1'}
            value={draft[i]}
            onChange={(e) => setDraft(draft.map((v, j) => (i === j ? e.target.value : v)))}
          />
        </label>
      ))}
      <button disabled={!valid} onClick={commitCorrection}>
        Apply correction
      </button>
      {!valid && (
        <p role="alert">
          Use emissivity 0.01–1, offset -20–20 °C and reflected temperature -20–120 °C.
        </p>
      )}
      <button
        onClick={() => {
          setDraft(['1', '0', '25']);
          update({ correction: { emissivity: 1, offsetKelvin: 0, reflectedCelsius: 25 } });
        }}
      >
        Reset parameters
      </button>
      <label>
        Ambient temperature (°C)
        <input disabled value="25" readOnly />
      </label>
      <p>Ambient correction unsupported. No camera commands are sent.</p>
    </section>
  );
}
