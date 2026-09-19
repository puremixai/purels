package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/store/postgres"
)

const (
	// exportHeader is both the exported column set and the import contract, so a
	// file written by ExportCSV can be fed straight back into ImportCSV.
	exportHeader = "alias,destination_url,title,tags,redirect_code"
	// maxExportRows bounds a single export. The whole table is never streamed
	// unbounded, and the admin can always narrow the list with filters.
	maxExportRows = 50000
	// maxImportRows bounds one import so a runaway file cannot pin the server.
	maxImportRows = 10000
	// maxReportErrors keeps the response small when every row is bad.
	maxReportErrors = 50
	// tagSeparator avoids forcing CSV quoting on every row that carries tags.
	tagSeparator = "|"
)

// aliasColumnNames lists the accepted spellings of the destination column, so
// files written by other tools import without being edited first.
var aliasColumnNames = []string{"destination_url", "url", "long_url", "destination"}

// ExportCSV renders every link matching filter as CSV text. The BOM is
// prepended because Excel reads a UTF-8 file as UTF-8 only when it sees one.
// The visibility scope is taken from the session so an export can never widen
// what the caller is allowed to list.
func (l *LinkService) ExportCSV(ctx context.Context, filter domain.ListFilter) (string, error) {
	filter.OwnerID = domain.OwnerIDFromContext(ctx)
	links, err := l.Store.ExportLinks(ctx, filter, maxExportRows)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	buf.WriteString("\uFEFF")
	out := csv.NewWriter(&buf)
	if err := out.Write(strings.Split(exportHeader, ",")); err != nil {
		return "", err
	}
	for _, link := range links {
		row := []string{
			link.Alias,
			link.DestinationURL,
			link.Title,
			strings.Join(link.Tags, tagSeparator),
			strconv.Itoa(int(link.RedirectCode)),
		}
		if err := out.Write(row); err != nil {
			return "", err
		}
	}
	out.Flush()
	return buf.String(), out.Error()
}

// ImportCSV creates links from a CSV file. Columns are matched by header name,
// so their order does not matter and columns the importer does not know (such
// as status or clicks) are ignored. A row that fails validation is reported and
// skipped; the remaining rows are still created.
func (l *LinkService) ImportCSV(ctx context.Context, r io.Reader) (domain.ImportReport, error) {
	report := domain.ImportReport{Errors: []domain.ImportError{}}
	reader := csv.NewReader(r)
	// Accept ragged rows and unescaped quotes: a single stray comma should cost
	// one row, not the whole file.
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true

	header, err := reader.Read()
	if errors.Is(err, io.EOF) {
		return report, errors.New("the file is empty")
	}
	if err != nil {
		return report, fmt.Errorf("could not read the header row: %w", err)
	}

	columns := map[string]int{}
	for i, name := range header {
		// Excel writes a UTF-8 BOM ahead of the first column name.
		key := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(name, "\uFEFF")))
		if key != "" {
			columns[key] = i
		}
	}
	destinationColumn := -1
	for _, name := range aliasColumnNames {
		if i, ok := columns[name]; ok {
			destinationColumn = i
			break
		}
	}
	if destinationColumn < 0 {
		return report, fmt.Errorf("the file needs a %q column", aliasColumnNames[0])
	}
	aliasColumn, titleColumn := columnIndex(columns, "alias"), columnIndex(columns, "title")
	tagsColumn, codeColumn := columnIndex(columns, "tags"), columnIndex(columns, "redirect_code")

	line := 1 // the header occupies line 1
	for {
		record, readErr := reader.Read()
		if errors.Is(readErr, io.EOF) {
			break
		}
		line++
		if readErr != nil {
			failRow(&report, line, "", readErr.Error())
			continue
		}
		if report.Created+report.Failed >= maxImportRows {
			failRow(&report, line, "", fmt.Sprintf("stopped after %d rows", maxImportRows))
			break
		}
		if isBlankRow(record) {
			continue
		}

		req := domain.CreateLinkRequest{
			DestinationURL: fieldAt(record, destinationColumn),
			Alias:          fieldAt(record, aliasColumn),
			Title:          fieldAt(record, titleColumn),
			Tags:           splitTags(fieldAt(record, tagsColumn)),
		}
		if raw := fieldAt(record, codeColumn); raw != "" {
			code, convErr := strconv.Atoi(raw)
			if convErr != nil {
				failRow(&report, line, req.Alias, "redirect_code must be 301 or 302")
				continue
			}
			req.RedirectCode = int16(code)
		}
		if _, err := l.Create(ctx, req); err != nil {
			failRow(&report, line, req.Alias, rowError(err))
			continue
		}
		report.Created++
	}
	return report, nil
}

// rowError turns one failed row into something safe to hand back to the caller.
//
// The report exists to say which row failed and why, so a service-level
// validation message — "redirect_code must be 301 or 302" — is passed through
// exactly as written; replacing it would throw away the only useful part.
//
// A database error is not. One that normalizeDBError did not classify still
// carries Postgres' own text, which names columns, constraints and SQLSTATEs,
// and the report is returned in the response body. The row is still identified
// by its line and alias, so the operator loses nothing but the SQL.
func rowError(err error) string {
	if postgres.IsDBError(err) {
		return "could not be saved"
	}
	return err.Error()
}

// columnIndex returns the position of a column, or -1 when the file omits it.
// A separate helper is needed because the zero value of int is a valid index.
func columnIndex(columns map[string]int, name string) int {
	if i, ok := columns[name]; ok {
		return i
	}
	return -1
}

func fieldAt(record []string, index int) string {
	if index < 0 || index >= len(record) {
		return ""
	}
	return strings.TrimSpace(record[index])
}

func isBlankRow(record []string) bool {
	for _, field := range record {
		if strings.TrimSpace(field) != "" {
			return false
		}
	}
	return true
}

// splitTags accepts the separator ExportCSV writes as well as the comma and
// whitespace an operator is likely to type by hand.
func splitTags(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	return strings.FieldsFunc(raw, func(r rune) bool {
		return r == '|' || r == ',' || r == ';' || unicode.IsSpace(r)
	})
}

func failRow(report *domain.ImportReport, line int, alias, reason string) {
	report.Failed++
	if len(report.Errors) < maxReportErrors {
		report.Errors = append(report.Errors, domain.ImportError{Line: line, Alias: alias, Reason: reason})
	}
}
