"""A desktop release cannot silently omit the phone binaries."""
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]


def workflow(name):
    data = yaml.safe_load((ROOT / '.github/workflows' / name).read_text(encoding="utf-8"))
    data['on'] = data.pop(True, data.get('on'))
    return data


def test_release_waits_for_both_phones_at_the_same_tag():
    jobs = workflow('electron-release.yml')['jobs']
    assert 'mobile' in jobs['release']['needs']
    mobile = jobs['mobile']
    # Upstream always ships both phones; this fork (Voice Suite) is desktop-only
    # unless its owner opts in, and then the same same-tag guarantees apply.
    assert mobile['if'] == "github.repository == 'debpalash/VoiceStudio' || vars.RELEASE_PHONE_APPS == 'true'"
    assert mobile['uses'] == './.github/workflows/mobile-release.yml'
    assert mobile['with']['release_ref'] == '${{ inputs.rehearsal && github.sha || inputs.release_tag || github.ref_name }}'
    called = workflow('mobile-release.yml')
    assert 'workflow_call' in called['on']
    for platform in ('android', 'ios'):
        job = called['jobs'][platform]
        assert 'inputs.release_ref' in job['steps'][0]['with']['ref']
        assert 'inputs.release_ref' in job['if']
        validation = next(s for s in job['steps'] if s.get('name') == 'Validate release source')
        assert 'refs/tags/${RELEASE_REF}^{commit}' in validation['run']
        assert 'package.json' in validation['run']
    steps = jobs['release']['steps']
    collect = next(s['run'] for s in steps if s.get('name') == 'Collect phone binaries')
    for extension in ('apk', 'aab', 'ipa'):
        assert extension in collect
    assert next(i for i,s in enumerate(steps) if s.get('name') == 'Collect phone binaries') < next(i for i,s in enumerate(steps) if s.get('name') == 'Validate all platforms before creating a release')


def test_sideload_ipa_does_not_depend_on_apple_signing():
    steps = workflow('mobile-release.yml')['jobs']['ios']['steps']
    unsigned = next(i for i,s in enumerate(steps) if s.get('name') == 'Unsigned iPhone build for sideloading')
    signing = next(i for i,s in enumerate(steps) if s.get('name') == 'Write App Store Connect API key')
    assert unsigned < signing
    for name in ('Write App Store Connect API key', 'Archive', 'Export IPA'):
        condition = next(s for s in steps if s.get('name') == name)['if']
        assert 'inputs.signed_ios' in condition
        assert "startsWith(github.ref, 'refs/tags/mobile-v')" in condition, 'tag-push callers must not force store signing'


def test_a_desktop_only_release_skips_every_phone_step():
    jobs = workflow('electron-release.yml')['jobs']
    release = jobs['release']
    assert release['env']['PHONE_APPS'] == "${{ needs.mobile.result != 'skipped' }}"
    steps = {s.get('name'): s for s in release['steps']}
    for name in ('Download the Android build', 'Download the iPhone build', 'Collect phone binaries'):
        assert steps[name]['if'] == "env.PHONE_APPS == 'true'", name
    android = steps['Update the Android repository after stable publication']
    assert "env.PHONE_APPS == 'true'" in android['if']
    notes = steps['Describe downloads and signing per platform']['run']
    assert 'if [ "$PHONE_APPS" != true ]; then NOTES_ARGS+=(--no-phones); fi' in notes
