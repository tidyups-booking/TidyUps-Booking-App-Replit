/**
 * Design tokens synced from the sibling booking-app (artifacts/booking-app/src/index.css).
 * Primary: Hot Pink/Magenta #EE3FCE  |  Secondary: Deep Purple #8870C4
 * Font: Poppins  |  Radius: 12px (0.75rem)
 */

const colors = {
  light: {
    // Legacy aliases
    text: '#171717',
    tint: '#EE3FCE',

    background: '#FAFAFA',
    foreground: '#171717',

    card: '#FFFFFF',
    cardForeground: '#171717',

    primary: '#EE3FCE',
    primaryForeground: '#FFFFFF',

    secondary: '#8870C4',
    secondaryForeground: '#FFFFFF',

    muted: '#F4F4F5',
    mutedForeground: '#757580',

    accent: '#F4F4F5',
    accentForeground: '#171717',

    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',

    border: '#E5E5EB',
    input: '#E5E5EB',
  },

  dark: {
    text: '#FAFAFA',
    tint: '#EE3FCE',

    background: '#171717',
    foreground: '#FAFAFA',

    card: '#1E1E1E',
    cardForeground: '#FAFAFA',

    primary: '#EE3FCE',
    primaryForeground: '#FFFFFF',

    secondary: '#8870C4',
    secondaryForeground: '#FFFFFF',

    muted: '#272729',
    mutedForeground: '#A3A3AF',

    accent: '#272729',
    accentForeground: '#FAFAFA',

    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',

    border: '#272729',
    input: '#272729',
  },

  // Border radius in px (synced from --radius: 0.75rem = 12px)
  radius: 12,
};

export default colors;
