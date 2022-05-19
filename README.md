# ImranR-Backup
My CLI tool to help automate the backup process for various local and cloud-based files. Some manual steps involved. 

## Usage
- Two variables must be defined at the top of `backup.sh`:
    - `MAINDIR`: Where the `Backups` subdirectory, along with other relevant subdirectories (`Documents`, `Media`, etc.), are stored - usually `~/Main`.
        - The required subdirectories of `MAINDIR` vary and are defined in the relevant backup script - an error is thrown if one if not found.
    - `EXPTDIR`: Where manually obtained files (such as cloud service data export ZIP files) are placed to be picked up by the script - usually `~/Downloads`.
- For each backup script, the relevant dependencies must be installed. If they are not, the script will throw an error.
- Run `backup.sh`.

## Structure
- Backup scripts are defined in `backup.sh`; this file also creates a CLI menu for the user to choose and run the scripts.
- The files in the subdirectories are dependencies used by various backup scripts. Some (like `WhatsApp`) may be specific to one script, while others (like `ExtractZips`) may be more general purpose.