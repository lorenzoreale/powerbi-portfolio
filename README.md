# Power BI portfolio

Three Power BI reports, each built end to end for a different reader and a different decision. They are saved as PBIP projects, so the model, the DAX and the Power Query steps can be read here without opening Power BI.

The clients are fictional and the data is synthetic, written by the generator script in each project.

| Project | For | The question |
|---|---|---|
| [Site Inspection Performance](site-inspection-performance/) | Operations review | Is the inspection programme on track, and which sites need a visit? |
| [Month-End Management Pack](month-end-management-pack/) | Finance director and partners | Why is profit different from budget this month? |
| [Data Reconciliation Monitor](data-reconciliation-monitor/) | The business each morning, and the data team | Can we use today's numbers? |

Each project holds the PBIP files, its source data, the generator, and a README on what the report shows and how it is built.

## Opening a project

Each project's README says how to open it. In short: open the `.pbip` file in Power BI Desktop, point the parameters in Transform data at the project's sources, then refresh. Site Inspection Performance reads a folder of CSV files; the Month-End Management Pack reads a SQL Server database built by the scripts in its `sql` folder, plus Excel workbooks.
