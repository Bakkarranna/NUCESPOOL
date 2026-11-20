export type NavView =
  | 'discover'
  | 'offer'
  | 'rides'
  | 'timetable'
  | 'messages'
  | 'profile'
  | 'admin';

export interface PageSeoConfig {
  path: string;
  title: string;
  description: string;
  keywords: string[];
  robots: string;
  breadcrumbName: string;
}

export const VIEW_PATHS: Record<NavView, string> = {
  discover: '/',
  offer: '/offer',
  rides: '/rides',
  timetable: '/timetable',
  messages: '/messages',
  profile: '/profile',
  admin: '/admin',
};

export const PAGE_SEO: Record<NavView, PageSeoConfig> = {
  discover: {
    path: '/',
    title: 'NUCESPOOL | FAST Chiniot Faisalabad Carpool',
    description:
      'Book or offer verified student rides between FAST-NUCES Chiniot Campus and Faisalabad. Match class timings and split fuel plus challans in cash.',
    keywords: [
      'NUCESPOOL',
      'FAST NUCES carpool',
      'FAST Chiniot Faisalabad ride share',
      'FAST CFD transport',
      'Chiniot to Faisalabad student ride',
      'Faisalabad to FAST Chiniot carpool',
      'NUCES Chiniot carry service',
      'FAST CFD timetable carpool',
      'student carpooling Pakistan',
      'Chiniot Faisalabad student commute',
      'Satellite Town Chiniot to FAST',
      'D-Ground Faisalabad to FAST Chiniot',
      'Canal Road Faisalabad student carpool',
    ],
    robots:
      'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    breadcrumbName: 'Find a Ride',
  },
  offer: {
    path: '/offer',
    title: 'Offer a Student Ride | NUCESPOOL FAST CFD',
    description:
      'Publish daily or recurring carpool seats and campus carry rides between Chiniot and Faisalabad for verified FAST-NUCES students.',
    keywords: [
      'offer ride FAST Chiniot',
      'FAST NUCES driver carpool',
      'post ride Chiniot Faisalabad',
      'FAST CFD carry service listing',
      'split fuel FAST students',
      'recurring campus carpool',
      'NUCESPOOL drop a ride',
    ],
    robots:
      'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    breadcrumbName: 'Offer a Ride',
  },
  rides: {
    path: '/rides',
    title: 'My Trips & Bookings | NUCESPOOL Carpool',
    description:
      'Track your confirmed FAST-NUCES Chiniot-Faisalabad carpool seats, pickup pins, cash fuel splits, and live ride SOS status.',
    keywords: [
      'NUCESPOOL my trips',
      'FAST carpool bookings',
      'Chiniot Faisalabad ride status',
      'student carpool pickup pin',
      'cash fuel and challan split',
      'FAST CFD ride safety SOS',
    ],
    robots:
      'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    breadcrumbName: 'My Trips',
  },
  timetable: {
    path: '/timetable',
    title: 'Timetable Ride Match | NUCESPOOL FAST CFD',
    description:
      'Upload your FAST-NUCES class timetable in PDF, image, or CSV to automatically match Chiniot and Faisalabad carpool departures.',
    keywords: [
      'FAST CFD timetable carpool',
      'FAST NUCES class schedule ride match',
      'Chiniot Faisalabad morning lecture carpool',
      'university timetable ride finder',
      'NUCESPOOL timetable sync',
    ],
    robots:
      'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    breadcrumbName: 'Timetable Match',
  },
  messages: {
    path: '/messages',
    title: 'Squad Chat & Pickup Coordination | NUCESPOOL',
    description:
      'Coordinate pickup stops, departure times, and live locations with your verified FAST-NUCES Chiniot-Faisalabad carpool squad.',
    keywords: [
      'NUCESPOOL squad chat',
      'FAST carpool messaging',
      'Chiniot Faisalabad pickup coordination',
      'student driver chat',
    ],
    robots:
      'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    breadcrumbName: 'Squad Chat',
  },
  profile: {
    path: '/profile',
    title: 'Student ID & Driver Verification | NUCESPOOL',
    description:
      'Verify your FAST-NUCES Student ID Card, roll number, CNIC, and vehicle details to book or host safe campus rides on NUCESPOOL.',
    keywords: [
      'FAST NUCES student verification',
      'NUCESPOOL student ID card',
      'FAST CFD driver CNIC verification',
      'verified student carpool Pakistan',
    ],
    robots:
      'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    breadcrumbName: 'Profile & Verification',
  },
  admin: {
    path: '/admin',
    title: 'Campus Admin Console | NUCESPOOL',
    description:
      'Campus moderation console for reviewing FAST-NUCES student IDs, driver CNICs, vehicles, corridors, and ride safety alerts.',
    keywords: ['NUCESPOOL admin', 'FAST CFD moderation'],
    robots: 'noindex, nofollow',
    breadcrumbName: 'Admin Console',
  },
};

export function getViewFromPath(pathname: string): NavView {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const match = (Object.entries(VIEW_PATHS) as [NavView, string][]).find(
    ([, p]) => p === clean
  );
  return match ? match[0] : 'discover';
}

function upsertMetaTag(
  attrName: 'name' | 'property',
  attrValue: string,
  content: string
) {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attrName}="${attrValue}"]`
  );
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonicalLink(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function applyPageSeo(view: NavView) {
  const cfg = PAGE_SEO[view];
  const origin = window.location.origin;
  const pageUrl = `${origin}${cfg.path}`;
  const imageUrl = `${origin}/nucespool-logo.png`;

  document.title = cfg.title;

  upsertMetaTag('name', 'description', cfg.description);
  upsertMetaTag('name', 'keywords', cfg.keywords.join(', '));
  upsertMetaTag('name', 'robots', cfg.robots);
  upsertMetaTag('name', 'googlebot', cfg.robots);

  upsertCanonicalLink(pageUrl);

  upsertMetaTag('property', 'og:url', pageUrl);
  upsertMetaTag('property', 'og:title', cfg.title);
  upsertMetaTag('property', 'og:description', cfg.description);
  upsertMetaTag('property', 'og:image', imageUrl);

  upsertMetaTag('name', 'twitter:url', pageUrl);
  upsertMetaTag('name', 'twitter:title', cfg.title);
  upsertMetaTag('name', 'twitter:description', cfg.description);
  upsertMetaTag('name', 'twitter:image', imageUrl);

  const jsonLdId = 'nucespool-page-jsonld';
  let scriptEl = document.getElementById(jsonLdId) as HTMLScriptElement | null;
  if (!scriptEl) {
    scriptEl = document.createElement('script');
    scriptEl.id = jsonLdId;
    scriptEl.type = 'application/ld+json';
    document.head.appendChild(scriptEl);
  }

  const breadcrumbs = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'NUCESPOOL Home',
      item: `${origin}/`,
    },
  ];
  if (view !== 'discover') {
    breadcrumbs.push({
      '@type': 'ListItem',
      position: 2,
      name: cfg.breadcrumbName,
      item: pageUrl,
    });
  }

  scriptEl.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${pageUrl}#webpage`,
        url: pageUrl,
        name: cfg.title,
        description: cfg.description,
        keywords: cfg.keywords.join(', '),
        inLanguage: 'en',
        isPartOf: {
          '@id': `${origin}/#website`,
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumbs,
      },
    ],
  });
}
