"""External signal mining — GitHub issue intent classifier + miner.

The package is invocable two ways:

  - As a module: ``python -m external_signal.github_miner``
  - As a script: ``python external_signal/github_miner.py``

Both forms work after this `__init__.py` lets sibling modules import
the package-relative way. The script form falls back to bare imports
so legacy invocations don't break.
"""
