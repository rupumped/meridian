#!/usr/bin/env python3
"""
Script to download and parse timezone data from the IANA tzdb repository,
outputting a JSON file with timezone name, label (country name), and region.
"""

import json
import urllib.request

ZONE_URL = "https://raw.githubusercontent.com/eggert/tz/refs/heads/main/zone1970.tab"
ISO_URL = "https://raw.githubusercontent.com/eggert/tz/c37fbc3249c1a1334948b38f3bca47dee5c11dd1/iso3166.tab"


def download_file(url: str) -> str:
	"""Download a file and return its contents as a string."""
	with urllib.request.urlopen(url) as response:
		return response.read().decode("utf-8")


def parse_iso3166(content: str) -> dict[str, str]:
	"""Parse iso3166.tab and return a dict mapping country codes to names."""
	country_map = {}
	for line in content.splitlines():
		line = line.strip()
		if not line or line.startswith("#"):
			continue
		parts = line.split("\t")
		if len(parts) >= 2:
			code = parts[0]
			name = parts[1]
			country_map[code] = name
	return country_map


def parse_zone1970(content: str, country_map: dict[str, str]) -> list[dict]:
	"""Parse zone1970.tab and return a list of timezone entries."""
	timezones = []
	for line in content.splitlines():
		line = line.strip()
		if not line or line.startswith("#"):
			continue
		parts = line.split("\t")
		if len(parts) >= 3:
			country_codes = parts[0].split(",")
			tz_name = parts[2]
			
			# Extract region from timezone name (e.g., "Europe" from "Europe/Andorra")
			region = tz_name.split("/")[0] if "/" in tz_name else tz_name
			
			# Get the country name from the first country code
			for country_code in country_codes:
				label = country_map.get(country_code, country_code)
				
				timezones.append({
					"name": tz_name,
					"label": label,
					"country": region
				})
	
	return timezones

if __name__ == "__main__":
	# Download both files
	print("Downloading zone1970.tab...")
	zone_content = download_file(ZONE_URL)
	
	print("Downloading iso3166.tab...")
	iso_content = download_file(ISO_URL)
	
	# Parse the files
	print("Parsing data...")
	country_map = parse_iso3166(iso_content)
	timezones = parse_zone1970(zone_content, country_map)
	
	# Output as JSON
	output_file = "timezones.json"
	with open(output_file, "w", encoding="utf-8") as f:
		json.dump(timezones, f, indent=2, ensure_ascii=False)
	
	print(f"Successfully wrote {len(timezones)} timezones to {output_file}")
