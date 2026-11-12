/**
 * Bangladesh administrative geography for the address forms.
 *
 * 8 divisions, 64 districts — the real set, not a sample. The reference file
 * has no geography data at all (its delivery widget only picks a district to
 * price delivery), so this is sourced from the country's actual administrative
 * structure rather than ported from `oshoppingbd.html`.
 *
 * Why the cascade stops at district: "area" in a Bangladeshi address is a
 * thana/upazila, and there are ~495 of them. A full list would be a 500-row
 * file that goes stale every time a new thana is created, and shoppers type
 * their own area name faster than they scroll a list. So `area` is a free-text
 * field with a `datalist` of the common ones for the busiest districts — the
 * suggestion is help, not a constraint.
 *
 * Bilingual: every name carries both scripts, because the address form renders
 * in whichever language the shopper chose and a Bangla form with English
 * district names is exactly the half-translated surface the gate rejects.
 */

export interface District {
  /** Stable slug — what gets stored and sent to the API. */
  value: string;
  en: string;
  bn: string;
}

export interface Division {
  value: string;
  en: string;
  bn: string;
  districts: District[];
}

/** Shorthand so the table below stays readable. */
function d(value: string, en: string, bn: string): District {
  return { value, en, bn };
}

export const DIVISIONS: Division[] = [
  {
    value: 'dhaka',
    en: 'Dhaka',
    bn: 'ঢাকা',
    districts: [
      d('dhaka', 'Dhaka', 'ঢাকা'),
      d('gazipur', 'Gazipur', 'গাজীপুর'),
      d('narayanganj', 'Narayanganj', 'নারায়ণগঞ্জ'),
      d('narsingdi', 'Narsingdi', 'নরসিংদী'),
      d('manikganj', 'Manikganj', 'মানিকগঞ্জ'),
      d('munshiganj', 'Munshiganj', 'মুন্সিগঞ্জ'),
      d('tangail', 'Tangail', 'টাঙ্গাইল'),
      d('kishoreganj', 'Kishoreganj', 'কিশোরগঞ্জ'),
      d('faridpur', 'Faridpur', 'ফরিদপুর'),
      d('gopalganj', 'Gopalganj', 'গোপালগঞ্জ'),
      d('madaripur', 'Madaripur', 'মাদারীপুর'),
      d('shariatpur', 'Shariatpur', 'শরীয়তপুর'),
      d('rajbari', 'Rajbari', 'রাজবাড়ী'),
    ],
  },
  {
    value: 'chattogram',
    en: 'Chattogram',
    bn: 'চট্টগ্রাম',
    districts: [
      d('chattogram', 'Chattogram', 'চট্টগ্রাম'),
      d('coxs-bazar', "Cox's Bazar", 'কক্সবাজার'),
      d('cumilla', 'Cumilla', 'কুমিল্লা'),
      d('brahmanbaria', 'Brahmanbaria', 'ব্রাহ্মণবাড়িয়া'),
      d('chandpur', 'Chandpur', 'চাঁদপুর'),
      d('feni', 'Feni', 'ফেনী'),
      d('noakhali', 'Noakhali', 'নোয়াখালী'),
      d('lakshmipur', 'Lakshmipur', 'লক্ষ্মীপুর'),
      d('khagrachhari', 'Khagrachhari', 'খাগড়াছড়ি'),
      d('rangamati', 'Rangamati', 'রাঙ্গামাটি'),
      d('bandarban', 'Bandarban', 'বান্দরবান'),
    ],
  },
  {
    value: 'rajshahi',
    en: 'Rajshahi',
    bn: 'রাজশাহী',
    districts: [
      d('rajshahi', 'Rajshahi', 'রাজশাহী'),
      d('bogura', 'Bogura', 'বগুড়া'),
      d('pabna', 'Pabna', 'পাবনা'),
      d('sirajganj', 'Sirajganj', 'সিরাজগঞ্জ'),
      d('natore', 'Natore', 'নাটোর'),
      d('naogaon', 'Naogaon', 'নওগাঁ'),
      d('chapainawabganj', 'Chapainawabganj', 'চাঁপাইনবাবগঞ্জ'),
      d('joypurhat', 'Joypurhat', 'জয়পুরহাট'),
    ],
  },
  {
    value: 'khulna',
    en: 'Khulna',
    bn: 'খুলনা',
    districts: [
      d('khulna', 'Khulna', 'খুলনা'),
      d('jashore', 'Jashore', 'যশোর'),
      d('satkhira', 'Satkhira', 'সাতক্ষীরা'),
      d('bagerhat', 'Bagerhat', 'বাগেরহাট'),
      d('kushtia', 'Kushtia', 'কুষ্টিয়া'),
      d('jhenaidah', 'Jhenaidah', 'ঝিনাইদহ'),
      d('magura', 'Magura', 'মাগুরা'),
      d('narail', 'Narail', 'নড়াইল'),
      d('chuadanga', 'Chuadanga', 'চুয়াডাঙ্গা'),
      d('meherpur', 'Meherpur', 'মেহেরপুর'),
    ],
  },
  {
    value: 'barishal',
    en: 'Barishal',
    bn: 'বরিশাল',
    districts: [
      d('barishal', 'Barishal', 'বরিশাল'),
      d('patuakhali', 'Patuakhali', 'পটুয়াখালী'),
      d('bhola', 'Bhola', 'ভোলা'),
      d('pirojpur', 'Pirojpur', 'পিরোজপুর'),
      d('barguna', 'Barguna', 'বরগুনা'),
      d('jhalokati', 'Jhalokati', 'ঝালকাঠি'),
    ],
  },
  {
    value: 'sylhet',
    en: 'Sylhet',
    bn: 'সিলেট',
    districts: [
      d('sylhet', 'Sylhet', 'সিলেট'),
      d('moulvibazar', 'Moulvibazar', 'মৌলভীবাজার'),
      d('habiganj', 'Habiganj', 'হবিগঞ্জ'),
      d('sunamganj', 'Sunamganj', 'সুনামগঞ্জ'),
    ],
  },
  {
    value: 'rangpur',
    en: 'Rangpur',
    bn: 'রংপুর',
    districts: [
      d('rangpur', 'Rangpur', 'রংপুর'),
      d('dinajpur', 'Dinajpur', 'দিনাজপুর'),
      d('nilphamari', 'Nilphamari', 'নীলফামারী'),
      d('kurigram', 'Kurigram', 'কুড়িগ্রাম'),
      d('lalmonirhat', 'Lalmonirhat', 'লালমনিরহাট'),
      d('gaibandha', 'Gaibandha', 'গাইবান্ধা'),
      d('thakurgaon', 'Thakurgaon', 'ঠাকুরগাঁও'),
      d('panchagarh', 'Panchagarh', 'পঞ্চগড়'),
    ],
  },
  {
    value: 'mymensingh',
    en: 'Mymensingh',
    bn: 'ময়মনসিংহ',
    districts: [
      d('mymensingh', 'Mymensingh', 'ময়মনসিংহ'),
      d('jamalpur', 'Jamalpur', 'জামালপুর'),
      d('netrokona', 'Netrokona', 'নেত্রকোণা'),
      d('sherpur', 'Sherpur', 'শেরপুর'),
    ],
  },
];

/** Districts for a division slug. Empty for an unknown division. */
export function districtsOf(divisionValue: string): District[] {
  return DIVISIONS.find((div) => div.value === divisionValue)?.districts ?? [];
}

/**
 * Common thana/upazila names, offered as `datalist` suggestions.
 *
 * Only the busiest districts are covered — the point is to save a shopper in
 * Dhaka from typing "Gulshan" wrong, not to be a complete gazetteer. An area
 * not listed here is still perfectly valid; the field is free text.
 */
export const AREA_SUGGESTIONS: Record<string, string[]> = {
  dhaka: [
    'Gulshan',
    'Banani',
    'Dhanmondi',
    'Mirpur',
    'Uttara',
    'Mohammadpur',
    'Bashundhara',
    'Motijheel',
    'Paltan',
    'Tejgaon',
    'Badda',
    'Rampura',
    'Khilgaon',
    'Jatrabari',
    'Savar',
    'Keraniganj',
  ],
  chattogram: [
    'Agrabad',
    'Kotwali',
    'Pahartali',
    'Panchlaish',
    'Double Mooring',
    'Halishahar',
    'Patenga',
    'Chandgaon',
  ],
  sylhet: ['Zindabazar', 'Ambarkhana', 'Shibganj', 'Beanibazar', 'Golapganj'],
  khulna: ['Khalishpur', 'Sonadanga', 'Daulatpur', 'Khan Jahan Ali', 'Kotwali'],
  rajshahi: ['Boalia', 'Motihar', 'Rajpara', 'Shah Makhdum'],
  barishal: ['Kotwali', 'Band Road', 'Nathullabad'],
  rangpur: ['Kotwali', 'Mahiganj', 'Pairaband'],
  mymensingh: ['Kotwali', 'Ganginarpar', 'Charpara'],
};

/** Suggestions for a district, or an empty list. */
export function areaSuggestions(districtValue: string): string[] {
  return AREA_SUGGESTIONS[districtValue] ?? [];
}

/** Localised division name for a stored slug. Falls back to the raw value. */
export function divisionLabel(value: string, lang: 'en' | 'bn'): string {
  const found = DIVISIONS.find((div) => div.value === value);
  return found ? found[lang] : value;
}

/** Localised district name for a stored slug. Falls back to the raw value. */
export function districtLabel(value: string, lang: 'en' | 'bn'): string {
  for (const division of DIVISIONS) {
    const found = division.districts.find((dist) => dist.value === value);
    if (found) return found[lang];
  }
  return value;
}
