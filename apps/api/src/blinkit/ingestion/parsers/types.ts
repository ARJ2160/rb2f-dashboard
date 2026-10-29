export interface ParseResult<T> {
  records: T[];
  dates: string[];
  rowsRead: number;
  warnings: string[];
}
