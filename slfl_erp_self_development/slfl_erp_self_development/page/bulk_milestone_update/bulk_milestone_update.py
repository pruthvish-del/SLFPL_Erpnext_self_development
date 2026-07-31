import frappe
from frappe.utils import getdate, cstr, now_datetime
from frappe.utils.xlsxutils import read_xlsx_file_from_attached_file
from frappe.utils.file_manager import save_file
import csv
import io
from datetime import datetime, timedelta

MAX_FILE_SIZE_MB = 10
BACKGROUND_JOB_THRESHOLD = 500  # rows -> switch to background processing

# Top-level Tracking tab fields that can also be filled from the file.
# key = column header (lowercase, trimmed) -> (fieldname, fieldtype, options)
FIELD_COLUMN_MAP = {
	"icegate job no": ("icegate_job_no", "Data", None),
	"be number": ("tracking_be_no", "Data", None),
	"sez request id no": ("sez_request_id_no", "Data", None),
	"be under query": ("be_under_query", "Select", ["No", "Yes"]),
	"be date": ("tracking_be_date", "Date", None),
}


def _validate_file_before_parse(file_doc):
	filename = (file_doc.file_name or "").lower()
	if not (filename.endswith(".xlsx") or filename.endswith(".csv")):
		frappe.throw("Only .csv and .xlsx files are supported.")

	size_mb = (file_doc.file_size or 0) / (1024 * 1024)
	if size_mb > MAX_FILE_SIZE_MB:
		frappe.throw(f"File is too large ({size_mb:.1f} MB). Maximum allowed size is {MAX_FILE_SIZE_MB} MB.")


def _get_file_rows(file_url):
	file_doc = frappe.get_doc("File", {"file_url": file_url})
	_validate_file_before_parse(file_doc)
	filename = (file_doc.file_name or "").lower()

	if filename.endswith(".xlsx"):
		rows = read_xlsx_file_from_attached_file(file_url=file_url)
	else:
		content = file_doc.get_content()
		if isinstance(content, bytes):
			content = content.decode("utf-8-sig")
		reader = csv.reader(io.StringIO(content))
		rows = [row for row in reader]

	rows = [r for r in rows if any(cstr(c).strip() for c in r)]

	if not rows:
		frappe.throw("The uploaded file is empty.")
	if len(rows) < 2:
		frappe.throw("The uploaded file has no data rows (only a header).")

	return rows


def _parse_date_cell(value):
	if value is None:
		return {"date": None, "invalid": False}

	if isinstance(value, (int, float)):
		try:
			base = datetime(1899, 12, 30)
			return {"date": (base + timedelta(days=float(value))).date(), "invalid": False}
		except Exception:
			return {"date": None, "invalid": True}

	text = cstr(value).strip()
	if not text:
		return {"date": None, "invalid": False}

	for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"):
		try:
			return {"date": datetime.strptime(text, fmt).date(), "invalid": False}
		except ValueError:
			continue

	try:
		return {"date": getdate(text), "invalid": False}
	except Exception:
		return {"date": None, "invalid": True}


def _parse_field_cell(fieldtype, options, value):
	"""Returns {"value": parsed_value_or_None, "invalid": bool} for a top-level Tracking field cell."""
	text = cstr(value).strip() if value is not None else ""
	if not text:
		return {"value": None, "invalid": False}

	if fieldtype == "Date":
		result = _parse_date_cell(value)
		return {"value": result["date"], "invalid": result["invalid"]}

	if fieldtype == "Select":
		for opt in options:
			if text.lower() == opt.lower():
				return {"value": opt, "invalid": False}
		return {"value": None, "invalid": True}

	# Data / plain text field
	return {"value": text, "invalid": False}


def _build_row_dicts(rows):
	"""
	Returns (order, parsed_by_shipment, duplicate_shipments)
	parsed_by_shipment[shipment_number] = {
		"milestones": {col_name: {"date":.., "invalid":..}, ...},
		"fields": {fieldname: {"label":.., "value":.., "invalid":..}, ...}
	}
	"""
	header = [cstr(h).strip() for h in rows[0]]
	if not header or not header[0]:
		frappe.throw("The first column of the file must be 'Shipment Number'.")

	all_headers = header[1:]
	data_rows = rows[1:]

	parsed_by_shipment = {}
	order = []
	seen = set()
	duplicate_shipments = set()

	for r in data_rows:
		if not r or not cstr(r[0]).strip():
			continue
		shipment_number = cstr(r[0]).strip()

		milestone_dates = {}
		field_values = {}

		for i, col_name in enumerate(all_headers):
			cell_idx = i + 1
			raw_value = r[cell_idx] if cell_idx < len(r) else None
			key = col_name.strip().lower()

			if key in FIELD_COLUMN_MAP:
				fieldname, fieldtype, options = FIELD_COLUMN_MAP[key]
				parsed = _parse_field_cell(fieldtype, options, raw_value)
				field_values[fieldname] = {"label": col_name, "value": parsed["value"], "invalid": parsed["invalid"]}
			else:
				milestone_dates[col_name] = _parse_date_cell(raw_value)

		if shipment_number in seen:
			duplicate_shipments.add(shipment_number)
		else:
			seen.add(shipment_number)
			order.append(shipment_number)

		parsed_by_shipment[shipment_number] = {"milestones": milestone_dates, "fields": field_values}

	return order, parsed_by_shipment, duplicate_shipments


def _match_milestones_for_shipment(shipment_doc, milestone_dates):
	existing_by_key = {(row.milestone_name or "").strip().lower(): row for row in shipment_doc.milestones}

	matched, unmapped, invalid_cells = [], [], []

	for col_name, cell in milestone_dates.items():
		key = col_name.strip().lower()
		is_mapped = key in existing_by_key

		if cell["invalid"]:
			(invalid_cells if is_mapped else unmapped).append(col_name)
			continue

		if cell["date"] is None:
			continue

		if is_mapped:
			matched.append({"milestone_row": existing_by_key[key], "milestone_name": col_name, "date": cell["date"]})
		else:
			unmapped.append(col_name)

	return matched, unmapped, invalid_cells


def _resolve_field_updates(field_values):
	"""
	Splits field_values into:
	- field_updates: list of {fieldname, label, value} to apply
	- invalid_fields: list of labels with an unparseable/invalid value
	Blank cells are absent from both (skip silently).
	"""
	field_updates = []
	invalid_fields = []

	for fieldname, info in field_values.items():
		if info["invalid"]:
			invalid_fields.append(info["label"])
		elif info["value"] is not None:
			field_updates.append({"fieldname": fieldname, "label": info["label"], "value": info["value"]})

	return field_updates, invalid_fields


@frappe.whitelist()
def validate_milestone_upload(file_url):
	rows = _get_file_rows(file_url)
	order, parsed_by_shipment, duplicate_shipments = _build_row_dicts(rows)

	preview_rows = []
	counts = {"ready": 0, "locked": 0, "error": 0}

	for shipment_number in order:
		entry = parsed_by_shipment[shipment_number]
		milestone_dates = entry["milestones"]
		field_values = entry["fields"]

		filled_milestone_count = sum(1 for c in milestone_dates.values() if c["date"] is not None)
		field_updates, invalid_fields = _resolve_field_updates(field_values)
		dup_note = "Duplicate rows found for this shipment — last occurrence used. " if shipment_number in duplicate_shipments else ""

		if not frappe.db.exists("Shipment 3PL", shipment_number):
			preview_rows.append({"shipment": shipment_number, "status": "error", "milestones_text": "-",
				"message": dup_note + "Shipment not found. Check the shipment number spelling."})
			counts["error"] += 1
			continue

		if not frappe.has_permission("Shipment 3PL", ptype="write", doc=shipment_number):
			preview_rows.append({"shipment": shipment_number, "status": "error", "milestones_text": "-",
				"message": dup_note + "You do not have permission to update this shipment."})
			counts["error"] += 1
			continue

		shipment_doc = frappe.get_doc("Shipment 3PL", shipment_number)

		if (shipment_doc.workflow_state or "").strip() == "Operations Complete":
			preview_rows.append({"shipment": shipment_number, "status": "locked",
				"milestones_text": f"{filled_milestone_count} milestone date(s) and {len(field_updates)} field(s) in file — none will be applied",
				"message": dup_note + "Workflow state is \"Operations Complete\" — Tracking tab is read-only for this shipment."})
			counts["locked"] += 1
			continue

		matched, unmapped, invalid_cells = _match_milestones_for_shipment(shipment_doc, milestone_dates)

		notes = [dup_note.strip()] if dup_note else []
		if unmapped:
			notes.append(f"Unmapped column(s) ignored: {', '.join(unmapped)}")
		if invalid_cells:
			notes.append(f"Invalid date value in: {', '.join(invalid_cells)} (not applied)")
		if invalid_fields:
			notes.append(f"Invalid value in: {', '.join(invalid_fields)} (not applied)")

		total_updates = len(matched) + len(field_updates)

		if total_updates == 0:
			preview_rows.append({"shipment": shipment_number, "status": "error", "milestones_text": "-",
				"message": " | ".join(notes) if notes else "No matching milestone or field columns found for this shipment."})
			counts["error"] += 1
			continue

		summary_parts = []
		if matched:
			summary_parts.append(", ".join(m["milestone_name"] for m in matched) + f" ({len(matched)} milestone date(s))")
		if field_updates:
			summary_parts.append(", ".join(f["label"] for f in field_updates) + f" ({len(field_updates)} field(s))")

		preview_rows.append({"shipment": shipment_number, "status": "ready",
			"milestones_text": " | ".join(summary_parts),
			"message": " | ".join(notes) if notes else "-"})
		counts["ready"] += 1

	return {
		"summary": {"total": len(order), "ready": counts["ready"], "locked": counts["locked"], "error": counts["error"]},
		"rows": preview_rows,
	}


def _apply_for_shipments(order, parsed_by_shipment, accepted_set):
	results = []

	for shipment_number in order:
		if shipment_number not in accepted_set:
			continue

		entry = parsed_by_shipment[shipment_number]
		milestone_dates = entry["milestones"]
		field_values = entry["fields"]

		try:
			if not frappe.db.exists("Shipment 3PL", shipment_number):
				results.append({"shipment": shipment_number, "status": "not_applied", "message": "Shipment not found."})
				continue

			shipment_doc = frappe.get_doc("Shipment 3PL", shipment_number)

			if (shipment_doc.workflow_state or "").strip() == "Operations Complete":
				results.append({"shipment": shipment_number, "status": "skipped", "message": "Locked — Operations Complete."})
				continue

			matched, unmapped, invalid_cells = _match_milestones_for_shipment(shipment_doc, milestone_dates)
			field_updates, invalid_fields = _resolve_field_updates(field_values)

			if not matched and not field_updates:
				msg = "No matching milestone or field columns found."
				bad = invalid_cells + invalid_fields
				if bad:
					msg += f" Invalid value(s) in: {', '.join(bad)}."
				results.append({"shipment": shipment_number, "status": "not_applied", "message": msg})
				continue

			current_time = now_datetime().time()
			for m in matched:
				m["milestone_row"].actual_date = datetime.combine(m["date"], current_time)

			for f in field_updates:
				shipment_doc.set(f["fieldname"], f["value"])

			shipment_doc.save()

			parts = []
			if matched:
				parts.append(f"{len(matched)} milestone date(s)")
			if field_updates:
				parts.append(f"{len(field_updates)} field(s) ({', '.join(f['label'] for f in field_updates)})")
			msg = "Saved: " + ", ".join(parts) + "."

			bad = invalid_cells + invalid_fields
			if bad:
				msg += f" Skipped invalid value(s) in: {', '.join(bad)}."

			results.append({"shipment": shipment_number, "status": "updated", "message": msg})

		except frappe.PermissionError:
			results.append({"shipment": shipment_number, "status": "not_applied", "message": "Permission denied."})
		except Exception as e:
			frappe.log_error(title="Bulk Milestone Update - row failed", message=frappe.get_traceback())
			results.append({"shipment": shipment_number, "status": "not_applied", "message": f"Error: {cstr(e)}"})

	frappe.db.commit()
	return results


def _create_audit_log(file_url, results):
	updated = sum(1 for r in results if r["status"] == "updated")
	skipped = sum(1 for r in results if r["status"] == "skipped")
	errored = sum(1 for r in results if r["status"] == "not_applied")

	try:
		source_file_name = frappe.get_doc("File", {"file_url": file_url}).file_name
	except Exception:
		source_file_name = file_url

	log_doc = frappe.get_doc({
		"doctype": "Milestone Bulk Update Log",
    	"run_by": frappe.session.user,
    	"run_at": frappe.utils.now_datetime(),
    	"source_file": source_file_name,
    	"total_rows": len(results),
    	"updated": updated,
    	"skipped": skipped,
    	"errors": errored,
	})
	log_doc.result_log_csv = file_doc.file_url
	log_doc.insert(ignore_permissions=True)

	safe_name = frappe.scrub(log_doc.name)
	csv_lines = ["Shipment No.,Result,Detail"]
	for r in results:
		detail = (r.get("message") or "").replace('"', '""')
		csv_lines.append(f'"{r["shipment"]}","{r["status"]}","{detail}"')

	file_doc = save_file(
		fname=f"bulk_milestone_result_{safe_name}.csv",
		content="\n".join(csv_lines),
		dt="Milestone Bulk Update Log",
		dn=log_doc.name,
		is_private=1,
	)
	log_doc.result_csv = file_doc.file_url
	log_doc.save(ignore_permissions=True)
	frappe.db.commit()

	return {"log_name": log_doc.name, "csv_url": file_doc.file_url}


@frappe.whitelist()
def apply_milestone_update(file_url, accepted_shipments):
	if isinstance(accepted_shipments, str):
		accepted_shipments = frappe.parse_json(accepted_shipments)

	rows = _get_file_rows(file_url)
	order, parsed_by_shipment, _ = _build_row_dicts(rows)
	accepted_set = set(accepted_shipments or [])

	if len(accepted_set) > BACKGROUND_JOB_THRESHOLD:
		job_token = frappe.generate_hash(length=10)
		frappe.enqueue(
			method="shipment.shipment.page.bulk_milestone_update.bulk_milestone_update._run_background_apply",
			queue="long",
			timeout=3600,
			job_token=job_token,
			file_url=file_url,
			accepted_shipments=list(accepted_set),
			user=frappe.session.user,
		)
		return {"background": True, "job_token": job_token, "total": len(accepted_set)}

	results = _apply_for_shipments(order, parsed_by_shipment, accepted_set)
	log_info = _create_audit_log(file_url, results)
	return {"background": False, "results": results, "log_name": log_info["log_name"], "csv_url": log_info["csv_url"]}


def _run_background_apply(job_token, file_url, accepted_shipments, user):
	frappe.set_user(user)
	try:
		rows = _get_file_rows(file_url)
		order, parsed_by_shipment, _ = _build_row_dicts(rows)
		accepted_set = set(accepted_shipments or [])

		results = _apply_for_shipments(order, parsed_by_shipment, accepted_set)
		log_info = _create_audit_log(file_url, results)

		frappe.publish_realtime(
			event="bulk_milestone_update_complete",
			message={"job_token": job_token, "results": results, "log_name": log_info["log_name"], "csv_url": log_info["csv_url"]},
			user=user,
		)
	except Exception:
		frappe.log_error(title="Bulk Milestone Update - background job failed", message=frappe.get_traceback())
		frappe.publish_realtime(
			event="bulk_milestone_update_complete",
			message={"job_token": job_token, "error": True,
				"error_message": "Background processing failed. Please check Error Log or contact your administrator."},
			user=user,
		)