from dotenv import load_dotenv
from pathlib import Path
load_dotenv(
    verbose=True,
    dotenv_path=Path(__file__).parent.joinpath("../.env")
)
