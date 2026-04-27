package com.fern.services.finance.application;

/**
 * Converts a VND amount (in cents) to Vietnamese words for invoice printing.
 * Handles amounts up to 999,999,999,999 VND (under 1 trillion).
 */
public final class VnAmountToWords {

  private VnAmountToWords() {}

  private static final String[] UNITS = {
      "", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"
  };
  private static final String[] TEENS = {
      "mười", "mười một", "mười hai", "mười ba", "mười bốn", "mười lăm",
      "mười sáu", "mười bảy", "mười tám", "mười chín"
  };

  public static String convert(long cents) {
    long vnd = cents / 100;
    if (vnd == 0) return "Không đồng";
    return capitalize(readNumber(vnd)) + " đồng";
  }

  private static String readNumber(long n) {
    if (n == 0) return "không";
    if (n < 0) return "âm " + readNumber(-n);

    StringBuilder sb = new StringBuilder();

    if (n >= 1_000_000_000L) {
      sb.append(readNumber(n / 1_000_000_000L)).append(" tỷ ");
      n %= 1_000_000_000L;
    }
    if (n >= 1_000_000L) {
      sb.append(readTriple((int)(n / 1_000_000L))).append(" triệu ");
      n %= 1_000_000L;
    }
    if (n >= 1_000L) {
      sb.append(readTriple((int)(n / 1_000L))).append(" nghìn ");
      n %= 1_000L;
    }
    if (n > 0) {
      sb.append(readTriple((int) n));
    }

    return sb.toString().trim();
  }

  private static String readTriple(int n) {
    if (n == 0) return "";
    int hundreds = n / 100;
    int remainder = n % 100;
    StringBuilder sb = new StringBuilder();
    if (hundreds > 0) {
      sb.append(UNITS[hundreds]).append(" trăm");
      if (remainder > 0 && remainder < 10) sb.append(" lẻ");
      if (remainder > 0) sb.append(" ");
    }
    if (remainder >= 10 && remainder < 20) {
      sb.append(TEENS[remainder - 10]);
    } else if (remainder > 0) {
      int tens = remainder / 10;
      int ones = remainder % 10;
      if (tens > 1) {
        sb.append(UNITS[tens]).append(" mươi");
        if (ones == 1) sb.append(" mốt");
        else if (ones == 5) sb.append(" lăm");
        else if (ones > 0) sb.append(" ").append(UNITS[ones]);
      } else if (tens == 1) {
        sb.append(TEENS[ones]);
      } else {
        sb.append(UNITS[ones]);
      }
    }
    return sb.toString().trim();
  }

  private static String capitalize(String s) {
    if (s == null || s.isEmpty()) return s;
    return Character.toUpperCase(s.charAt(0)) + s.substring(1);
  }
}
