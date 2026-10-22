import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeIndianState } from '../src/lib/states';

test('state names from the Cult VC export collapse to one spelling each', () => {
  const cases: Record<string, string> = {
    'MAHARASHTRA': 'Maharashtra', 'MAHARASHATRA': 'Maharashtra', 'MAHARASTRA': 'Maharashtra', 'MAHRASHTRA': 'Maharashtra', MH: 'Maharashtra',
    'TELANGANA': 'Telangana', 'TELENGANA': 'Telangana', TG: 'Telangana',
    'UTTAR PRADESH': 'Uttar Pradesh', 'UTTARPRADESH': 'Uttar Pradesh', 'U.P.': 'Uttar Pradesh', UP: 'Uttar Pradesh',
    'DELHI': 'Delhi', 'NEW DELHI': 'Delhi', 'SOUTH DELHI': 'Delhi', DL: 'Delhi',
    'CHATTISGARH': 'Chhattisgarh', 'TAMILNADU': 'Tamil Nadu', 'PONDICHERRY': 'Puducherry',
    'JAMMU & KASHMIR': 'Jammu and Kashmir', JK: 'Jammu and Kashmir',
    'DADRA & NAGAR HAVELI': 'Dadra and Nagar Haveli and Daman and Diu', 'DAMAN & DIU': 'Dadra and Nagar Haveli and Daman and Diu',
    'ANDAMAN & NICOBAR ISLANDS': 'Andaman and Nicobar Islands', 'WEST BENGAL': 'West Bengal', WB: 'West Bengal',
    KA: 'Karnataka', KL: 'Kerala', RJ: 'Rajasthan', MP: 'Madhya Pradesh', LADAKH: 'Ladakh', '': 'Unknown',
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(normalizeIndianState(raw), want, raw);
});
