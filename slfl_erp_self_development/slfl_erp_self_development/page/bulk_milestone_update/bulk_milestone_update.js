frappe.pages["bulk-milestone-update"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Bulk Milestone Update",
		single_column: true,
	});

	new BulkMilestoneWizard(page);
};

class BulkMilestoneWizard {
	constructor(page) {
		this.page = page;
		this.step = 1;
		this.uploaded_file_url = null;
		this.uploaded_file_name = null;
		this.preview_data = null;
		this.render_shell();
		this.render_step1();
	}

	render_shell() {
		this.page.main.html(`
			<style>
				.bmw-scroll { max-height: calc(100vh - 170px); overflow-y: auto; padding: 4px 2px 30px; }
				.bmw-wrap { max-width: 920px; margin: 6px auto 0; }

				.bmw-stepper { display:flex; margin-bottom:30px; padding: 0 10px; }
				.bmw-step { flex:1; display:flex; flex-direction:column; align-items:center; position:relative; }
				.bmw-step .dot {
					width:28px; height:28px; border-radius:50%; flex:none;
					display:flex; align-items:center; justify-content:center;
					font-size:12px; font-weight:600; border:2px solid var(--gray-300, #d1d8dd);
					color:var(--text-muted, #8d99a6); background:var(--fg-color, #fff);
					margin-bottom:8px; position:relative; z-index:1;
				}
				.bmw-step .lbl {
					font-size:12px; font-weight:600; color:var(--text-muted, #8d99a6);
					text-align:center; white-space:nowrap;
				}
				.bmw-step.done .dot { background:var(--primary, #2490ef); border-color:var(--primary, #2490ef); color:#fff; }
				.bmw-step.done .lbl { color:var(--text-color, #36414c); }
				.bmw-step.active .dot { border-color:var(--primary, #2490ef); color:var(--primary, #2490ef); }
				.bmw-step.active .lbl { color:var(--text-color, #36414c); }
				.bmw-step:not(:last-child)::after {
					content:""; position:absolute; top:13px;
					left:calc(50% + 22px); right:calc(-50% + 22px);
					height:2px; background:var(--gray-300, #d1d8dd); z-index:0;
				}
				.bmw-step.done:not(:last-child)::after { background:var(--primary, #2490ef); }

				.bmw-panel {
					background:var(--card-bg, #fff); border:1px solid var(--border-color, #d1d8dd);
					border-radius:var(--border-radius-md, 8px); padding:20px 22px; margin-bottom:16px;
				}
				.bmw-panel h4 { margin:0 0 4px; font-weight:600; }
				.bmw-panel .desc { color:var(--text-muted, #8d99a6); font-size:12.5px; margin:0 0 16px; }

				.bmw-help-box {
					background: var(--alert-bg-info, #eef6fc);
					border: 1px solid var(--alert-border-info, #cfe4f5);
					border-radius: 6px;
					padding: 12px 14px;
					margin-bottom: 18px;
					font-size: 12.5px;
					color: var(--text-color, #36414c);
				}
				.bmw-help-box b { display:block; margin-bottom:6px; font-size:13px; }
				.bmw-help-box ul { margin:0; padding-left:18px; }
				.bmw-help-box li { margin-bottom:3px; }
				.bmw-help-box code {
					background: var(--bg-color, #f4f6f7);
					padding: 1px 5px;
					border-radius: 3px;
					font-size: 11.5px;
				}

				.bmw-chips { display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
				.bmw-chip {
					flex:1; min-width:120px; border:1px solid var(--border-color, #d1d8dd);
					border-radius:6px; padding:10px 12px;
				}
				.bmw-chip .n { font-size:20px; font-weight:700; }
				.bmw-chip .l { font-size:10.5px; color:var(--text-muted, #8d99a6); text-transform:uppercase; }
				.bmw-chip.total .n { color:var(--primary, #2490ef); }
				.bmw-chip.ok .n { color:var(--green, #2f7a52); }
				.bmw-chip.warn .n { color:var(--orange, #b9772e); }
				.bmw-chip.err .n { color:var(--red, #a63d3d); }

				.bmw-table-wrap {
					max-height: 360px; overflow-y: auto; border:1px solid var(--border-color, #d1d8dd);
					border-radius:6px;
				}
				.bmw-table { width:100%; border-collapse:collapse; font-size:12.5px; margin:0; }
				.bmw-table thead th {
					position: sticky; top:0; z-index:1;
					text-align:left; padding:8px 10px; background:var(--subtle-fg, #f4f6f7);
					color:var(--text-muted, #8d99a6); font-size:11px; text-transform:uppercase;
					border-bottom:1px solid var(--border-color, #d1d8dd);
				}
				.bmw-table td { padding:8px 10px; border-bottom:1px solid var(--border-color, #eef1f2); vertical-align:top; }
				.bmw-table tr:last-child td { border-bottom:none; }
				.bmw-shipnum { font-family:var(--font-mono, monospace); font-weight:600; }

				.bmw-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }
				.bmw-dropzone {
					border:2px dashed var(--border-color, #b9c6c6); border-radius:8px; padding:34px 18px;
					text-align:center; background:var(--subtle-fg, #fafbfb); cursor:pointer;
				}
				.bmw-dropzone:hover { background:var(--subtle-accent, #f1f4f4); }
				.bmw-filepill {
					display:inline-flex; align-items:center; gap:6px; margin-top:14px; padding:6px 12px;
					background:var(--green-100, #e9f5ee); color:var(--green-600, #2f7a52);
					border-radius:16px; font-size:12px; font-weight:600;
				}
				.bmw-filepill svg { width:14px; height:14px; }
				.bmw-resultbanner {
					display:flex; gap:12px; align-items:center; padding:14px 16px; border-radius:6px;
					background:var(--green-100, #e9f5ee); border:1px solid var(--green-200, #cfe8db);
					margin-bottom:16px;
				}
				.bmw-resultbanner .icon-holder svg { width:22px; height:22px; color:var(--green-600, #2f7a52); }
				#bmw-download-btn svg { width:13px; height:13px; margin-right:4px; vertical-align:-2px; }
			</style>
			<div class="bmw-scroll">
				<div class="bmw-wrap">
					<div class="bmw-stepper">
						<div class="bmw-step" data-step="1"><div class="dot">1</div><div class="lbl">Upload</div></div>
						<div class="bmw-step" data-step="2"><div class="dot">2</div><div class="lbl">Preview &amp; Validate</div></div>
						<div class="bmw-step" data-step="3"><div class="dot">3</div><div class="lbl">Confirm &amp; Results</div></div>
					</div>
					<div class="bmw-content"></div>
				</div>
			</div>
		`);
		this.$wrap = this.page.main.find(".bmw-wrap");
		this.$content = this.page.main.find(".bmw-content");

		// Button to navigate back to the Shipment 3PL list view
		this.page.set_secondary_action("Go to Shipment 3PL List", () => {
			frappe.set_route("shipment-3pl");
		});

		this.page.add_inner_button("View Update Logs", () => {
			frappe.set_route("milestone-bulk-update-log");
		});
	}

	update_stepper() {
		this.$wrap.find(".bmw-step").each((i, el) => {
			let n = i + 1;
			$(el).removeClass("done active");
			if (n < this.step) $(el).addClass("done");
			else if (n === this.step) $(el).addClass("active");
		});
	}

	status_pill(status) {
		const map = {
			ready: ["green", "Ready"],
			locked: ["orange", "Locked"],
			error: ["red", "Error"],
			updated: ["green", "Updated"],
			skipped: ["orange", "Skipped"],
			not_applied: ["red", "Not applied"],
		};
		const [color, label] = map[status] || ["gray", status];
		return `<span class="indicator-pill ${color}" style="white-space:nowrap;">${label}</span>`;
	}

	// ---------------- SCREEN 1: UPLOAD ----------------
	render_step1() {
		this.step = 1;
		this.update_stepper();
		this.page.clear_primary_action();
		this.$content.html(`
			<div class="bmw-panel">
				<h4>Upload File</h4>
				<p class="desc">First column must be Shipment Number. Remaining columns must be named exactly like the milestone.</p>

				<div class="bmw-help-box">
					<b>File format:</b>
					<ul>
						<li>Column 1: <code>Shipment Number</code>. Other columns: exact milestone names (e.g. <code>BE Filed</code>).</li>
						<li>Fill a date only where you want an update — blank cells are skipped, existing dates stay untouched.</li>
						<li>Accepted formats: <code>DD-MM-YYYY</code>, <code>DD/MM/YYYY</code>, <code>YYYY-MM-DD</code>, or Excel native date.</li>
						<li>Only <code>.csv</code>/<code>.xlsx</code>, max 10 MB.</li>
						<li>Shipments already "Operations Complete" are locked and won't be updated.</li>
					</ul>
				</div>

				<div class="bmw-dropzone" id="bmw-dropzone">
					<div style="font-weight:600;margin-bottom:4px;">Click to select a .xlsx or .csv file</div>
					<div style="color:var(--text-muted, #8d99a6);font-size:12px;">Accepts .xlsx or .csv</div>
					<div id="bmw-filepill-holder"></div>
				</div>
				<div class="bmw-actions">
					<button class="btn btn-primary btn-sm" id="bmw-parse-btn" disabled>Parse &amp; Preview &rarr;</button>
				</div>
			</div>
		`);

		this.$content.find("#bmw-dropzone").on("click", (e) => {
			if ($(e.target).closest(".bmw-filepill").length) return;
			new frappe.ui.FileUploader({
				allow_multiple: false,
				restrictions: { allowed_file_types: [".csv", ".xlsx"] },
				on_success: (file_doc) => {
					this.uploaded_file_url = file_doc.file_url;
					this.uploaded_file_name = file_doc.file_name;
					this.$content
						.find("#bmw-filepill-holder")
						.html(
							`<div class="bmw-filepill">${frappe.utils.icon(
								"small-file",
								"sm"
							)} ${frappe.utils.escape_html(file_doc.file_name)}</div>`
						);
					this.$content.find("#bmw-parse-btn").prop("disabled", false);
				},
			});
		});

		this.$content.find("#bmw-parse-btn").on("click", () => this.parse_and_preview());
	}

	parse_and_preview() {
		frappe.dom.freeze("Parsing file...");
		frappe.call({
			method: "slfl_erp_self_development.slfl_erp_self_development.page.bulk_milestone_update.bulk_milestone_update.validate_milestone_upload",
			args: { file_url: this.uploaded_file_url },
			callback: (r) => {
				frappe.dom.unfreeze();
				if (!r.exc) {
					this.preview_data = r.message;
					this.render_step2();
				}
			},
			error: () => frappe.dom.unfreeze(),
		});
	}

	// ---------------- SCREEN 2: PREVIEW ----------------
	render_step2() {
		this.step = 2;
		this.update_stepper();
		let s = this.preview_data.summary;
		let rows = this.preview_data.rows;

		let rows_html = rows
			.map((row, idx) => {
				let checkable = row.status === "ready";
				return `
				<tr data-idx="${idx}">
					<td><input type="checkbox" class="bmw-rowchk" ${checkable ? "checked" : "disabled"}></td>
					<td class="bmw-shipnum">${frappe.utils.escape_html(row.shipment)}</td>
					<td>${this.status_pill(row.status)}</td>
					<td>${frappe.utils.escape_html(row.milestones_text || "-")}</td>
					<td style="color:var(--text-muted, #8d99a6);">${frappe.utils.escape_html(row.message || "-")}</td>
				</tr>`;
			})
			.join("");

		this.$content.html(`
			<div class="bmw-panel">
				<h4>Preview &amp; Validate</h4>
				<p class="desc">Server has parsed the file and checked every row. Nothing has been saved yet.</p>

				<div class="bmw-help-box">
					<b>Before you proceed:</b>
					<ul>
						<li>Only checked <b>Ready</b> rows will be updated when you click "Update" below.</li>
						<li><b>Locked</b> rows (Operations Complete) and <b>Error</b> rows are skipped automatically.</li>
						<li>Uncheck any "Ready" row to exclude it — nothing is saved until you click "Update".</li>
						<li>See the <b>Message</b> column for the reason behind a Locked/Error status.</li>
					</ul>
				</div>

				<div class="bmw-chips">
					<div class="bmw-chip total"><div class="n">${s.total}</div><div class="l">Rows in file</div></div>
					<div class="bmw-chip ok"><div class="n">${s.ready}</div><div class="l">Ready</div></div>
					<div class="bmw-chip warn"><div class="n">${s.locked}</div><div class="l">Locked</div></div>
					<div class="bmw-chip err"><div class="n">${s.error}</div><div class="l">Error</div></div>
				</div>
				<div class="bmw-table-wrap">
					<table class="bmw-table">
						<thead><tr><th></th><th>Shipment No.</th><th>Status</th><th>Milestones</th><th>Message</th></tr></thead>
						<tbody>${rows_html}</tbody>
					</table>
				</div>
				<div class="bmw-actions">
					<button class="btn btn-default btn-sm" id="bmw-back-btn">&larr; Back to upload</button>
					<button class="btn btn-primary btn-sm" id="bmw-apply-btn">Update ${s.ready} shipment(s) &rarr;</button>
				</div>
			</div>
		`);

		this.$content.find("#bmw-back-btn").on("click", () => this.render_step1());
		this.$content.find("#bmw-apply-btn").on("click", () => this.apply_updates());
	}

	apply_updates() {
		let accepted = [];
		this.$content.find("tbody tr").each((i, el) => {
			let $chk = $(el).find(".bmw-rowchk");
			if ($chk.is(":checked") && !$chk.is(":disabled")) {
				accepted.push(this.preview_data.rows[$(el).data("idx")].shipment);
			}
		});

		frappe.dom.freeze("Applying updates...");
		frappe.call({
			method: "slfl_erp_self_development.slfl_erp_self_development.page.bulk_milestone_update.bulk_milestone_update.apply_milestone_update",
			args: {
				file_url: this.uploaded_file_url,
				accepted_shipments: accepted,
			},
			callback: (r) => {
				frappe.dom.unfreeze();
				if (r.exc) return;

				if (r.message.background) {
					frappe.msgprint(
						`Large file detected (${r.message.total} rows). Processing in background — you'll be notified when done.`
					);
					frappe.realtime.on("bulk_milestone_update_complete", (data) => {
						if (data.job_token !== r.message.job_token) return;
						if (data.error) {
							frappe.msgprint({
								title: "Update Failed",
								message: data.error_message,
								indicator: "red",
							});
							return;
						}

						frappe.show_alert(
							{
								message: "Bulk milestone update completed successfully.",
								indicator: "green",
							},
							7
						);

						this.results = data.results;
						this.log_csv_url = data.csv_url;
						this.error_csv_url = data.error_csv_url;
						this.render_step3();
					});
					return;
				}

				this.results = r.message.results;
				this.log_csv_url = r.message.csv_url;
				this.error_csv_url = r.message.error_csv_url;
				this.render_step3();
			},
			error: () => frappe.dom.unfreeze(),
		});
	}

	// ---------------- SCREEN 3: RESULTS ----------------
	render_step3() {
		this.step = 3;
		this.update_stepper();

		let rows_html = this.results
			.map(
				(row) => `
			<tr>
				<td class="bmw-shipnum">${frappe.utils.escape_html(row.shipment)}</td>
				<td>${this.status_pill(row.status)}</td>
				<td style="color:var(--text-muted, #8d99a6);">${frappe.utils.escape_html(row.message || "-")}</td>
			</tr>`
			)
			.join("");

		this.$content.html(`
			<div class="bmw-panel">
				<h4>Confirm &amp; Results</h4>
				<div class="bmw-resultbanner">
					<div class="icon-holder">
							<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<circle cx="12" cy="12" r="10"></circle>
								<path d="M8 12l2.5 2.5L16 9"></path>
							</svg>
					</div>
					<div>
						<b>Run completed</b><br>
						<span style="color:var(--text-muted, #8d99a6);font-size:12px;">${frappe.datetime.now_datetime()} — by ${
			frappe.session.user
		}</span>
					</div>
				</div>

				<div class="bmw-help-box">
					<b>What this means:</b>
					<ul>
						<li><b>Updated</b> — milestone date(s) saved to the Tracking tab.</li>
						<li><b>Skipped</b> — shipment was locked (Operations Complete) when applied.</li>
						<li><b>Not applied</b> — not found, no permission, or no matching milestone.</li>
						<li>This run is recorded in the <b>Milestone Bulk Update Log</b>.</li>
					</ul>
				</div>

				<div class="bmw-table-wrap">
					<table class="bmw-table">
						<thead><tr><th>Shipment No.</th><th>Result</th><th>Detail</th></tr></thead>
						<tbody>${rows_html}</tbody>
					</table>
				</div>
				<div class="bmw-actions">
					${
						this.error_csv_url
							? `
					<button class="btn btn-default btn-sm" id="bmw-download-errors-btn" style="border-color:var(--red-400,#e86161);color:var(--red-600,#a63d3d);">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right:4px;vertical-align:-2px;">
							<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"></path>
						</svg>
						Download error rows (CSV)
					</button>`
							: ""
					}
					<button class="btn btn-default btn-sm" id="bmw-download-btn">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right:4px;vertical-align:-2px;">
							<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"></path>
						</svg>
						Download result log (CSV)
					</button>
					<button class="btn btn-primary btn-sm" id="bmw-restart-btn">Start a new upload</button>
				</div>
			</div>
		`);

		this.$content.find("#bmw-restart-btn").on("click", () => this.render_step1());
		this.$content.find("#bmw-download-btn").on("click", () => this.download_csv());
		this.$content
			.find("#bmw-download-errors-btn")
			.on("click", () => this.download_error_csv());
	}

	download_csv() {
		if (this.log_csv_url) {
			window.open(this.log_csv_url, "_blank");
		} else {
			frappe.msgprint(__("Result log file is not available."));
		}
	}

	download_error_csv() {
		if (this.error_csv_url) {
			window.open(this.error_csv_url, "_blank");
		} else {
			frappe.msgprint("No error rows to download.");
		}
	}
}
